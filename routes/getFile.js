import { Router } from "express";
import shardPath from "../utils/shardPath.js";
import fsp from "fs/promises";
import fs from "fs";
import mime from "mime";

const router = Router();

router.get("/file/:filename", async (req, res) => {
	const basePath = shardPath(req.params.filename);

	// Candidate paths to try, including original, jpeg<->jpg swap, and .bin fallback
	const candidates = [
		basePath,
		basePath.replace(/\.(jpe?g)$/i, (ext) =>
			ext.toLowerCase() === ".jpeg" ? ".jpg" : ".jpeg"
		),
		basePath.replace(/\.[^/.]+$/, "") + ".bin",
	].filter(Boolean);

	let stat;
	let filePath;

	try {
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

		if (!stat) {
			return res.status(404).json({ error: "File not found" });
		}

		// Handle Range requests
		const range = req.headers.range;
		const fileSize = stat.size;
		const contentType = mime.getType(filePath) || "application/octet-stream";

		if (range) {
			const parts = range.replace(/bytes=/, "").split("-");
			const start = parseInt(parts[0], 10);
			const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

			if (start >= fileSize || end >= fileSize || start > end) {
				res
					.status(416)
					.set({
						"Content-Range": `bytes */${fileSize}`,
					})
					.end();
				return;
			}

			res.status(206).set({
				"Content-Range": `bytes ${start}-${end}/${fileSize}`,
				"Accept-Ranges": "bytes",
				"Content-Length": end - start + 1,
				"Content-Type": contentType,
			});

			const readStream = fs.createReadStream(filePath, { start, end });
			readStream.pipe(res);
		} else {
			res.status(200).set({
				"Content-Length": fileSize,
				"Content-Type": contentType,
				"Accept-Ranges": "bytes",
			});

			const readStream = fs.createReadStream(filePath);
			readStream.pipe(res);
		}
	} catch (err) {
        console.error(err);
		res.status(404).json({ error: "File not found" });
	}
});

export default router;