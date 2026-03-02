import browser from './browser-polyfill';
import { sanitizeFileName } from './string-utils';

/**
 * Extracts all remote image URLs from a Markdown string.
 * Matches standard Markdown image syntax: ![alt](https://...)
 * Skips data: URIs and already-relative/vault-local paths.
 */
export function extractRemoteImageUrls(markdown: string): string[] {
    const regex = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
    const urls: string[] = [];
    let match;
    while ((match = regex.exec(markdown)) !== null) {
        urls.push(match[1]);
    }
    return [...new Set(urls)]; // deduplicate
}

/**
 * Derives a safe local filename from a remote image URL.
 * e.g. https://example.com/assets/hero.png?w=800 → "hero.png"
 *
 * Falls back to a timestamped generic name if no filename can be parsed.
 */
export function imageUrlToFilename(url: string): string {
    try {
        const u = new URL(url);
        const rawName = u.pathname.split('/').pop() || 'image';
        // Separate stem and extension
        const dotIdx = rawName.lastIndexOf('.');
        const stem = dotIdx !== -1 ? rawName.slice(0, dotIdx) : rawName;
        const ext = dotIdx !== -1 ? rawName.slice(dotIdx) : '.png';
        const safeStem = sanitizeFileName(stem) || 'image';
        // Keep extension lowercase, strip query params that may have crept in
        const safeExt = ext.replace(/[?#].*$/, '').toLowerCase() || '.png';
        return safeStem + safeExt;
    } catch {
        return `image_${Date.now()}.png`;
    }
}

/**
 * Sends a message to the background service worker to trigger
 * browser.downloads.download() for a single image.
 *
 * Returns true on success; false + logs a warning on failure.
 */
async function requestImageDownload(imageUrl: string, filePath: string): Promise<boolean> {
    try {
        const response = await browser.runtime.sendMessage({
            action: 'downloadImage',
            imageUrl,
            filePath
        }) as { success: boolean; downloadId?: number; error?: string };

        if (!response.success) {
            console.warn(`[image-downloader] Download rejected for ${imageUrl}:`, response.error);
            return false;
        }
        return true;
    } catch (err) {
        console.warn(`[image-downloader] Message failed for ${imageUrl}:`, err);
        return false;
    }
}

/**
 * Downloads all remote images referenced in `markdown` to the user's
 * Downloads folder under `<sanitizedVaultName>/<attachmentFolder>/`,
 * then rewrites those image links to vault-relative paths so Obsidian
 * can resolve them.
 *
 * Any image that fails to download keeps its original remote URL
 * (graceful degradation — the clip always saves).
 *
 * @param markdown         - Rendered Markdown body (no frontmatter)
 * @param vaultName        - Obsidian vault name, used as the top-level
 *                           folder inside Downloads to mirror vault layout
 * @param attachmentFolder - Vault-relative attachment folder (e.g. "_attachments")
 * @returns Rewritten markdown with local image paths where downloads succeeded
 */
export async function downloadImagesToVault(
    markdown: string,
    vaultName: string,
    attachmentFolder: string
): Promise<string> {
    const imageUrls = extractRemoteImageUrls(markdown);
    if (imageUrls.length === 0) return markdown;

    // Map: original URL → vault-relative path (populated on success)
    const urlToLocal = new Map<string, string>();

    // Track used filenames to avoid local collisions between different URLs
    // that happen to resolve to the same filename
    const usedFilenames = new Set<string>();

    const safeVault = sanitizeFileName(vaultName) || 'vault';
    const safeFolder = attachmentFolder.replace(/^\/|\/$/g, '') || '_attachments';

    await Promise.allSettled(imageUrls.map(async (url) => {
        let filename = imageUrlToFilename(url);

        // Deduplicate locally if two different URLs share the same filename
        if (usedFilenames.has(filename)) {
            const dotIdx = filename.lastIndexOf('.');
            const stem = dotIdx !== -1 ? filename.slice(0, dotIdx) : filename;
            const ext = dotIdx !== -1 ? filename.slice(dotIdx) : '';
            filename = `${stem}_${Date.now()}${ext}`;
        }
        usedFilenames.add(filename);

        // Path inside the user's Downloads folder:
        // <VaultName>/<attachmentFolder>/<filename>
        const filePath = `${safeVault}/${safeFolder}/${filename}`;
        const vaultRelativePath = `${safeFolder}/${filename}`;

        const ok = await requestImageDownload(url, filePath);
        if (ok) {
            urlToLocal.set(url, vaultRelativePath);
        }
    }));

    if (urlToLocal.size === 0) return markdown;

    // Rewrite all matched image links whose download succeeded
    return markdown.replace(
        /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g,
        (match, alt, url) => {
            const local = urlToLocal.get(url);
            return local ? `![${alt}](${local})` : match;
        }
    );
}
