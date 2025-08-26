import { Router } from "express";
import shardPath from "../utils/shardPath.js";
import fsp from "fs/promises";
import path from "path";
import { getUsage, setUsage } from "../utils/diskUsage.js";
import crypto from "crypto";
import fs from "fs";
import mime from "mime";
import { Readable } from "stream";
import env from "../utils/env.js";
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const s3Client = env.s3Client;
const STORAGE_PATH = env.STORAGE_PATH || "./storage";

const router = Router();

async function downloadToStorage(url) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
	}

	let ext = path.extname(new URL(url).pathname).toLowerCase();
	if (!ext) {
		const contentType = response.headers.get("content-type");
		if (contentType) {
			ext = "." + mime.getExtension(contentType) || "";
		}
	}
	if (!ext) {
		ext = "";
	}

	const hash = crypto.createHash("md5");
	const nodeStream = Readable.fromWeb(response.body);

	if (env.S3) {
		const chunks = [];
		for await (const chunk of nodeStream) {
			hash.update(chunk);
			chunks.push(chunk);
		}

		const md5sum = hash.digest("hex");
		const filename = md5sum + ext;
		const Key = shardPath(filename);

		try {
			const head = await s3Client.send(new HeadObjectCommand({
				Bucket: env.S3_BUCKET,
				Key
			}));
			// File already exists
			return { md5: md5sum, size: head.ContentLength };
		} catch (err) {
			if (err.name !== "NotFound") throw err;
		}

		const buffer = Buffer.concat(chunks);

		await s3Client.send(new PutObjectCommand({
			Bucket: env.S3_BUCKET,
			Key,
			Body: buffer,
			ContentType: response.headers.get("content-type") || "application/octet-stream"
		}));

		await setUsage(getUsage() + buffer.length);

		return { md5: md5sum, size: buffer.length };
	} else {
		const tmpPath = path.join(STORAGE_PATH, "tmp_" + crypto.randomBytes(8).toString("hex"));
		const writeStream = fs.createWriteStream(tmpPath);

		return new Promise((resolve, reject) => {
			nodeStream.on("data", (chunk) => hash.update(chunk));
			nodeStream.pipe(writeStream);

			writeStream.on("finish", async () => {
				const md5sum = hash.digest("hex");
				const filename = md5sum + ext;
				const finalPath = shardPath(filename);

				try {
					try {
						const stat = await fsp.stat(finalPath);
						await fsp.unlink(tmpPath);
						resolve({ md5: md5sum, size: stat.size });
						return;
					} catch {}

					await fsp.mkdir(path.dirname(finalPath), { recursive: true });
					await fsp.rename(tmpPath, finalPath);

					const stat = await fsp.stat(finalPath);
					await setUsage(getUsage() + stat.size);

					resolve({ md5: md5sum, size: stat.size });
				} catch (err) {
					await fsp.unlink(tmpPath).catch(() => {});
					reject(err);
				}
			});

			writeStream.on("error", async (err) => {
				await fsp.unlink(tmpPath).catch(() => {});
				reject(err);
			});
		});
	}
}


router.post("/download-url", async (req, res) => {
	const { url } = req.body;
	if (!url) return res.status(400).json({ error: "Missing url field" });

	try {
		const { md5, size } = await downloadToStorage(url);
		res.json({ md5, size });
	} catch (err) {
		console.error("Download error:", err);
		res.status(500).json({ error: "Failed to download file" });
	}
});

export default router;
