import { Router } from "express";
import shardPath from "../utils/shardPath.js";
import fsp from "fs/promises";
import path from "path";
import { getUsage, setUsage } from "../utils/diskUsage.js";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const STORAGE_PATH = process.env.STORAGE_PATH || "./storage";

const router = Router();

router.put("/file/:filename", async (req, res) => {
    // Shard file path
    const filePath = shardPath(req.params.filename);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });

    // Get (existing) file size
    let byteCount = 0;
    let existingSize = 0;

    try {
        const stat = await fsp.stat(filePath);
        existingSize = stat.size;
    } catch {
        existingSize = 0;
    }

    // Write the (new) file
    const writeStream = fs.createWriteStream(filePath);
    req.on("data", (chunk) => (byteCount += chunk.length));
    req.pipe(writeStream);

    // Update disk usage
    writeStream.on("finish", async () => {
        let totalSize = getUsage() - existingSize + byteCount;
        await setUsage(totalSize);
        res.json({
            uploaded: req.params.filename,
            replaced: existingSize > 0,
            oldSize: existingSize,
            newSize: byteCount,
            totalSize,
        });
    });

    writeStream.on("close", () => {
        console.log(`File ${req.params.filename} uploaded successfully.`);
    });

    writeStream.on("error", (err) => {
        console.error(err);
        res.status(500).json({ error: "Failed to write file" });
    });
});

export default router;