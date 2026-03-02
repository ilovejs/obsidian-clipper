import browser from './browser-polyfill';

/**
 * Extracts all remote image URLs from a Markdown string.
 * Matches: ![alt](https://...) — skips data: URIs and relative paths.
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
 * Asks the background service worker to fetch an image URL and return
 * it as a base64 data URI string (e.g. "data:image/png;base64,...").
 *
 * The background has unrestricted fetch access via <all_urls> host_permissions,
 * so cross-origin images that would be blocked in a content script work fine here.
 *
 * Returns null if the fetch fails (network error, 4xx/5xx, CORS block, etc.)
 */
async function fetchAsDataUri(imageUrl: string): Promise<string | null> {
    try {
        const response = await browser.runtime.sendMessage({
            action: 'fetchImageAsBase64',
            imageUrl
        }) as { success: boolean; dataUri?: string; error?: string };

        if (!response.success || !response.dataUri) {
            console.warn(`[image-downloader] Fetch failed for ${imageUrl}:`, response.error);
            return null;
        }
        return response.dataUri;
    } catch (err) {
        console.warn(`[image-downloader] Message error for ${imageUrl}:`, err);
        return null;
    }
}

/**
 * Fetches all remote images referenced in `markdown` via the background
 * service worker, converts them to base64 data URIs, and embeds them
 * directly in the markdown content.
 *
 * Result example:
 *   Before: ![hero](https://example.com/hero.png)
 *   After:  ![hero](data:image/png;base64,iVBORw0KGgo...)
 *
 * Benefits over disk-based approaches:
 * - No filesystem access needed — works regardless of vault location
 * - Images are permanently self-contained in the note
 * - Obsidian renders data: URIs natively in both editor and preview
 * - Truly offline and immune to link rot
 *
 * Images that fail to fetch (404, CORS, network error) keep their original
 * remote URL — the clip always saves successfully (graceful degradation).
 *
 * @param markdown - Rendered Markdown body (no frontmatter)
 * @returns Markdown with remote image URLs replaced by data: URIs
 */
export async function embedImagesAsDataUris(markdown: string): Promise<string> {
    const imageUrls = extractRemoteImageUrls(markdown);
    if (imageUrls.length === 0) return markdown;

    // Fetch all images concurrently; keep a URL→dataUri map for rewriting
    const urlToDataUri = new Map<string, string>();

    await Promise.allSettled(
        imageUrls.map(async (url) => {
            const dataUri = await fetchAsDataUri(url);
            if (dataUri) {
                urlToDataUri.set(url, dataUri);
            }
        })
    );

    if (urlToDataUri.size === 0) return markdown;

    // Rewrite image links whose fetch succeeded; leave others untouched
    return markdown.replace(
        /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g,
        (match, alt, url) => {
            const dataUri = urlToDataUri.get(url);
            return dataUri ? `![${alt}](${dataUri})` : match;
        }
    );
}
