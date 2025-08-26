import { Router } from "express";
import shardPath from "../utils/shardPath.js";
import fsp from "fs/promises";
import path from "path";
import { getUsage, setUsage } from "../utils/diskUsage.js";
import generateCandidatePaths from "../utils/candidatePaths.js";
import env from "../utils/env.js";
import { HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const s3Client = env.s3Client;

const router = Router();

router.delete("/file/:filename", async (req, res) => {
	const basePath = shardPath(req.params.filename);

	// Generate candidate paths for the file
	const candidates = generateCandidatePaths(basePath);

	let stat;
	let filePath;

	try {
		if (env.S3) {
			// S3 logic
			const Key = candidates[0]; // Use the first candidate as S3 object key
			const command = new HeadObjectCommand({
				Bucket: env.S3_BUCKET,
				Key,
			});

			let size;
			try {
				const head = await s3Client.send(command);
				size = head.ContentLength;
			} catch (err) {
				if (err.name === "NotFound") {
					return res.status(404).json({ error: "File not found" });
				}
				throw err;
			}

			await s3Client.send(
				new DeleteObjectCommand({
					Bucket: env.S3_BUCKET,
					Key,
				})
			);

			await setUsage(getUsage() - size);

			return res.json({ deleted: path.basename(Key), sizeFreed: size });
		} else {
			// FS logic
			// Check each candidate path for existence
			for (const candidate of candidates) {
				try {
					stat = await fsp.stat(candidate);
					filePath = candidate;
					break; // Found file, exit loop
				} catch (err) {
					if (err.code !== "ENOENT") throw err;
				}
			}

			// If no file found, return 404
			if (!stat) {
				return res.status(404).json({ error: "File not found" });
			}

			await fsp.unlink(filePath);
			await setUsage(getUsage() - stat.size);

			res.json({ deleted: path.basename(filePath), sizeFreed: stat.size });
		}
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: "Failed to delete file" });
	}
});

export default router;
