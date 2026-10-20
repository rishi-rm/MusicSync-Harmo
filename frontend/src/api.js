const API_BASE_URL = (
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_UPLOAD_SERVER_URL ||
    'https://musicsync-1-p4h4.onrender.com'
).replace(/\/$/, '')

const SOCKET_URL = (
    import.meta.env.VITE_SOCKET_SERVER_URL || API_BASE_URL
).replace(/\/$/, '')

console.log('[CONFIG] API URL:', API_BASE_URL)
console.log('[CONFIG] Socket URL:', SOCKET_URL)

async function parseResponse(response, fallbackMessage) {
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
        throw new Error(data.message || fallbackMessage)
    }

    return data
}

export async function fetchSongs() {
    const response = await fetch(`${API_BASE_URL}/songs`)
    const data = await parseResponse(response, 'Failed to load songs.')
    return Array.isArray(data.songs) ? data.songs : []
}

export async function uploadSong({ files, artist, album }) {
    const formData = new FormData()
    files.forEach((file) => formData.append('song', file))
    formData.append('artist', artist.trim())
    formData.append('album', album.trim())

    const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData
    })

    const data = await parseResponse(response, 'Failed to upload song.')

    if (!Array.isArray(data.songs) || data.songs.length === 0) {
        throw new Error('The upload response did not include the created songs.')
    }

    return data.songs
}

export async function updateSongFavorite(songId, isFavorite) {
    const response = await fetch(`${API_BASE_URL}/songs/${songId}/favorite`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite })
    })

    const data = await parseResponse(response, 'Failed to update favourite status.')

    if (!data.song) {
        throw new Error('The favourite response did not include the updated song.')
    }

    return data.song
}

export { API_BASE_URL, SOCKET_URL }
