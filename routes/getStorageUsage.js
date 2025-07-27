import { Router } from "express";
import { getUsage } from "../utils/diskUsage.js";

const router = Router();

router.get("/storage-usage", (req, res) => {
    let totalSize = getUsage();
    if (totalSize === undefined) {
        return res.status(500).json({ error: "Failed to retrieve storage usage" });
    }
	res.json({ totalSizeBytes: totalSize });
});

export default router;