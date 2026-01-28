/**
 * Google Drive URL utilities
 * 
 * Convert Google Drive sharing URLs to direct image URLs
 */

/**
 * Convert a Google Drive sharing URL to a direct thumbnail URL
 * 
 * Input formats:
 * - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 * - https://drive.google.com/file/d/FILE_ID/view?usp=drive_link
 * - https://drive.google.com/open?id=FILE_ID
 * 
 * Output:
 * - https://drive.google.com/thumbnail?id=FILE_ID&sz=w400
 */
export function convertDriveUrlToImage(url: string): string {
    if (!url) return ''

    // Already a direct URL or non-Drive URL
    if (!url.includes('drive.google.com')) {
        return url
    }

    // Extract file ID from Drive URL
    let fileId = ''

    // Format: /file/d/FILE_ID/
    const fileMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/)
    if (fileMatch && fileMatch[1]) {
        fileId = fileMatch[1]
    }

    // Format: ?id=FILE_ID or &id=FILE_ID
    if (!fileId) {
        const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]+)/)
        if (idMatch && idMatch[1]) {
            fileId = idMatch[1]
        }
    }

    if (fileId) {
        // Use Google Drive's thumbnail API - more reliable than lh3
        return `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`
    }

    // Return original URL if not a Drive URL
    return url
}

/**
 * Get a placeholder image URL for missing images
 */
export function getPlaceholderImage(): string {
    return 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjIwMCIgaGVpZ2h0PSIyMDAiIGZpbGw9IiNFNUU3RUIiLz48Y2lyY2xlIGN4PSIxMDAiIGN5PSI4MCIgcj0iMzUiIGZpbGw9IiM5Q0EzQUYiLz48cGF0aCBkPSJNNDAgMTgwQzQwIDE0NS44MTcgNjcuMzY0NiAxMjAgMTAwIDEyMEMxMzIuNjM1IDEyMCAxNjAgMTQ1LjgxNyAxNjAgMTgwIiBmaWxsPSIjOUNBM0FGIi8+PC9zdmc+'
}
