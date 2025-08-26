import express from "express";
import fsp from "fs/promises";
import { loadUsage } from "./utils/diskUsage.js";
import env from "./utils/env.js";

const app = express();
const PORT = env.PORT || 3000;
const STORAGE_PATH = env.STORAGE_PATH || "./storage";

app.use(express.json());


// Require API key for all routes if set
if (env.REQUIRE_API_KEY !== "false") {
	app.use((req, res, next) => {
		if (req.headers["x-api-key"] !== env.API_KEY) {
			return res.status(403).json({ error: "Forbidden" });
		}
		next();
	});
}

// Log all requests and how long it took
app.use((req, res, next) => {
	const start = Date.now();
	const timestamp = new Date().toISOString();
	
	res.on("finish", () => {
		const duration = Date.now() - start;
		console.log(`[${timestamp}] ${req.method} ${req.originalUrl} - ${res.statusCode} - ${duration}ms`);
	});
	
	next();
});

// Load disk usage at startup
await loadUsage();

// Create storage directory if it doesn't exist
await fsp.mkdir(STORAGE_PATH, { recursive: true });

// GET /storage-usage
import getStorageUsage from "./routes/getStorageUsage.js";
app.use(getStorageUsage);

// PUT /file/:filename
import fileUpload from "./routes/fileUpload.js";
app.use(fileUpload);

// GET /file/:filename
import getFile from "./routes/getFile.js";
app.use(getFile);

// DELETE /file/:filename
import deleteFile from "./routes/deleteFile.js";
app.use(deleteFile);

// POST /download-url
import downloadFile from "./routes/downloadFile.js";
app.use(downloadFile);

// Start server
app.listen(PORT, async () => {
	console.log(`Server running on port ${PORT}`);
});
