import { Router } from "express";
import shardPath from "../utils/shardPath.js";
import fsp from "fs/promises";
import path from "path";
import { getUsage, setUsage } from "../utils/diskUsage.js";


const router = Router();

router.delete("/file/:filename", async (req, res) => {
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

		await fsp.unlink(filePath);
		await setUsage(getUsage() - stat.size);

		res.json({ deleted: path.basename(filePath), sizeFreed: stat.size });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: "Failed to delete file" });
	}
});

export default router;