import { Router } from "express";
import shardPath from "../utils/shardPath.js";
import fsp from "fs/promises";
import path from "path";
import { getUsage, setUsage } from "../utils/diskUsage.js";
import fs from "fs";
import env from "../utils/env.js";
import { PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";

const s3Client = env.s3Client;

const router = Router();

router.put("/file/:filename", async (req, res) => {
	const filename = req.params.filename;
	const filePath = shardPath(filename);
	let existingSize = 0;

	if (env.S3) {
		const Key = filePath;
		try {
			const head = await s3Client.send(
				new HeadObjectCommand({
					Bucket: env.S3_BUCKET,
					Key,
				})
			);
			existingSize = head.ContentLength ?? 0;
		} catch (err) {
			if (err.name !== "NotFound") throw err;
		}

		const chunks = [];
		let byteCount = 0;

		for await (const chunk of req) {
			chunks.push(chunk);
			byteCount += chunk.length;
		}

		const bodyBuffer = Buffer.concat(chunks);

		await s3Client.send(
			new PutObjectCommand({
				Bucket: env.S3_BUCKET,
				Key,
				Body: bodyBuffer,
			})
		);

		const totalSize = getUsage() - existingSize + byteCount;
		await setUsage(totalSize);

		return res.json({
			uploaded: filename,
			replaced: existingSize > 0,
			oldSize: existingSize,
			newSize: byteCount,
			totalSize,
		});
	} else {
		await fsp.mkdir(path.dirname(filePath), { recursive: true });

		try {
			const stat = await fsp.stat(filePath);
			existingSize = stat.size;
		} catch {
			existingSize = 0;
		}

		let byteCount = 0;
		const writeStream = fs.createWriteStream(filePath);

		req.on("data", (chunk) => (byteCount += chunk.length));
		req.pipe(writeStream);

		writeStream.on("finish", async () => {
			const totalSize = getUsage() - existingSize + byteCount;
			await setUsage(totalSize);

			res.json({
				uploaded: filename,
				replaced: existingSize > 0,
				oldSize: existingSize,
				newSize: byteCount,
				totalSize,
			});
		});

		writeStream.on("error", (err) => {
			console.error(err);
			res.status(500).json({ error: "Failed to write file" });
		});
	}
});

export default router;