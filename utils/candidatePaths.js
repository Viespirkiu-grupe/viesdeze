/**
 * Generates an array of candidate paths based on the provided base path.
 * It includes the original path, a modified version with the extension swapped
 * between .jpeg and .jpg, and a version with the extension removed, a version replaced by .bin.
 *
 * @param {string} basePath - The base file path to generate candidates from.
 * @returns {string[]} An array of candidate paths.
 */
export default function generateCandidatePaths(basePath) {
    return [
        basePath,
        basePath.replace(/\.(jpe?g)$/i, (ext) =>
            ext.toLowerCase() === ".jpeg" ? ".jpg" : ".jpeg",
        ),
        basePath.replace(/\.[^/.]+$/, ""),
        basePath.replace(/\.[^/.]+$/, "") + ".bin",
        basePath.replace(/\.[^/.]+$/, "") + ".php",
    ].filter(Boolean);
}
