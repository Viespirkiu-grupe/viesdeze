import express from "express";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import dotenv from "dotenv";
import mime from "mime";
import crypto from "crypto";
import { Readable } from "stream";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const STORAGE_PATH = process.env.STORAGE_PATH || "./storage";
const USAGE_FILE = "./usage.json";
const API_KEY = process.env.API_KEY || "";
const REQUIRE_API_KEY = process.env.REQUIRE_API_KEY !== "false";

// Route: POST /download-url
// Body: { url: "https://..." }
app.use(express.json());

let totalSize = 0;

// Utility: Get sharded file path
function shardPath(filename) {
	const shard = filename.slice(0, 2);
	return path.join(STORAGE_PATH, shard, filename);
}

// Middleware: API key check
if (REQUIRE_API_KEY) {
	app.use((req, res, next) => {
		if (req.headers["x-api-key"] !== API_KEY) {
			return res.status(403).json({ error: "Forbidden" });
		}
		next();
	});
}

// Load usage from disk
async function loadUsage() {
	try {
		const data = JSON.parse(await fsp.readFile(USAGE_FILE, "utf8"));
		totalSize = data.totalSize || 0;
		console.log(`Loaded usage: ${totalSize} bytes`);
	} catch {
		totalSize = 0;
		console.log("No existing usage.json, starting fresh.");
	}
}

// Save usage to disk
async function saveUsage() {
	await fsp.writeFile(USAGE_FILE, JSON.stringify({ totalSize }));
}

// Recalculate total size (slow, done in background)
async function calculateTotalSize() {
	let size = 0;
	const walk = async (dir) => {
		const entries = await fsp.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
			} else {
				const stat = await fsp.stat(fullPath);
				size += stat.size;
			}
		}
	};
	try {
		await walk(STORAGE_PATH);
		totalSize = size;
		await saveUsage();
		console.log(`Recalculated total size: ${size} bytes`);
	} catch (err) {
		console.error("Failed to recalculate storage:", err);
	}
}

// API: Get total storage used
app.get("/storage-usage", (req, res) => {
	res.json({ totalSizeBytes: totalSize });
});

// API: Upload file
app.put("/file/:filename", async (req, res) => {
	const filePath = shardPath(req.params.filename);
	await fsp.mkdir(path.dirname(filePath), { recursive: true });

	let byteCount = 0;
	let existingSize = 0;

	try {
		const stat = await fsp.stat(filePath);
		existingSize = stat.size;
	} catch {
		existingSize = 0; // File doesn't exist
	}

	const writeStream = fs.createWriteStream(filePath);
	req.on("data", (chunk) => (byteCount += chunk.length));
	req.pipe(writeStream);

	writeStream.on("finish", async () => {
		totalSize = totalSize - existingSize + byteCount;
		await saveUsage();
		res.json({
			uploaded: req.params.filename,
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
});

app.get("/file/:filename", async (req, res) => {
	const basePath = shardPath(req.params.filename);

	// Candidate paths to try
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
		for (const candidate of candidates) {
			try {
				stat = await fsp.stat(candidate);
				filePath = candidate;
				break; // found file
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
		res.status(404).json({ error: "File not found" });
	}
});

app.delete("/file/:filename", async (req, res) => {
	const basePath = shardPath(req.params.filename);

	// Prepare candidate paths: original, jpeg<->jpg swap, .bin fallback
	const candidates = [
		basePath,
		basePath.replace(/\.(jpe?g)$/i, (ext) =>
			ext.toLowerCase() === ".jpeg" ? ".jpg" : ".jpeg"
		),
		basePath.replace(/\.[^/.]+$/, "") + ".bin",
	].filter(Boolean); // filter out undefined if no swap happened

	let stat;
	let filePath;

	try {
		for (const candidate of candidates) {
			try {
				stat = await fsp.stat(candidate);
				filePath = candidate;
				break; // found existing file, stop loop
			} catch (err) {
				if (err.code !== "ENOENT") throw err; // other errors bubble up
			}
		}

		if (!stat) {
			// none found
			return res.status(404).json({ error: "File not found" });
		}

		await fsp.unlink(filePath);
		totalSize -= stat.size;
		await saveUsage();

		res.json({ deleted: path.basename(filePath), sizeFreed: stat.size });
	} catch (err) {
		console.error(err);
		res.status(500).json({ error: "Failed to delete file" });
	}
});

async function downloadToStorage(url) {
	const response = await fetch(url);
	if (!response.ok)
		throw new Error(`Failed to fetch ${url}: ${response.statusText}`);

	let ext = path.extname(new URL(url).pathname).toLowerCase();
	if (!ext) {
		const contentType = response.headers.get("content-type");
		if (contentType) ext = "." + mime.getExtension(contentType) || "";
	}
	if (!ext) ext = "";

	const hash = crypto.createHash("md5");
	const tmpPath = path.join(
		STORAGE_PATH,
		"tmp_" + crypto.randomBytes(8).toString("hex")
	);
	await fsp.mkdir(STORAGE_PATH, { recursive: true });
	const writeStream = fs.createWriteStream(tmpPath);

	const nodeStream = Readable.fromWeb(response.body);

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
				totalSize += stat.size;
				await saveUsage();

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

app.post("/download-url", async (req, res) => {
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

// Start server
app.listen(PORT, async () => {
	await fsp.mkdir(STORAGE_PATH, { recursive: true });
	await loadUsage();
	console.log(`Server running on port ${PORT}`);

	// Background correction every 6 hours
	// setInterval(calculateTotalSize, 6 * 60 * 60 * 1000);
});
