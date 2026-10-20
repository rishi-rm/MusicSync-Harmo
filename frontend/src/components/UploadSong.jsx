import { useRef, useState } from 'react'
import { uploadSong } from '../api.js'

const MAX_FILE_SIZE_MB = Number(import.meta.env.VITE_MAX_FILE_SIZE_MB || 20)
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024

function titleFromFileName(fileName) {
    return fileName.trim().replace(/\.mp3$/i, '').trim()
}

export default function UploadSong({ onSongUploaded }) {
    const fileInputRef = useRef(null)
    const [selectedFiles, setSelectedFiles] = useState([])
    const [artist, setArtist] = useState('')
    const [album, setAlbum] = useState('')
    const [uploading, setUploading] = useState(false)
    const [message, setMessage] = useState('')
    const [error, setError] = useState('')

    function handleFileChange(event) {
        const files = Array.from(event.target.files || [])
        setMessage('')
        setError('')

        if (files.length === 0) {
            setSelectedFiles([])
            return
        }

        const invalidFile = files.find((file) => {
            const isMp3 = file.name.toLowerCase().endsWith('.mp3')
            const hasAudioMimeType = !file.type || ['audio/mpeg', 'audio/mp3'].includes(file.type)
            return !isMp3 || !hasAudioMimeType || file.size > MAX_FILE_SIZE
        })

        if (invalidFile && (!invalidFile.name.toLowerCase().endsWith('.mp3') || (invalidFile.type && !['audio/mpeg', 'audio/mp3'].includes(invalidFile.type)))) {
            setSelectedFiles([])
            setError('Please choose MP3 files only.')
            event.target.value = ''
            return
        }

        if (invalidFile) {
            setSelectedFiles([])
            setError(`Each MP3 file must be ${MAX_FILE_SIZE_MB} MB or smaller.`)
            event.target.value = ''
            return
        }

        setSelectedFiles(files)
    }

    async function handleSubmit(event) {
        event.preventDefault()
        setMessage('')
        setError('')

        if (selectedFiles.length === 0) {
            setError('Please choose at least one MP3 file first.')
            return
        }

        setUploading(true)

        try {
            const songs = await uploadSong({ files: selectedFiles, artist, album })
            onSongUploaded(songs)
            setMessage(`${songs.length} ${songs.length === 1 ? 'song' : 'songs'} added to your library.`)
            setSelectedFiles([])
            setArtist('')
            setAlbum('')

            if (fileInputRef.current) {
                fileInputRef.current.value = ''
            }
        } catch (uploadError) {
            console.error('Song upload failed:', uploadError)
            setError(uploadError instanceof Error ? uploadError.message : 'Failed to upload song.')
        } finally {
            setUploading(false)
        }
    }

    return (
        <section className="panel upload-panel" aria-labelledby="upload-heading">
            <div className="section-heading">
                <div>
                    <p className="eyebrow">Add to the room</p>
                    <h2 id="upload-heading">Upload a song</h2>
                </div>
                <span className="upload-icon" aria-hidden="true">＋</span>
            </div>

            <form className="upload-form" onSubmit={handleSubmit}>
                <label className="file-dropzone">
                    <input ref={fileInputRef} type="file" accept="audio/mpeg,audio/mp3,.mp3" multiple onChange={handleFileChange} />
                    <span className="file-mark" aria-hidden="true">♫</span>
                    <strong>{selectedFiles.length ? `${selectedFiles.length} MP3 files selected` : 'Choose MP3 files'}</strong>
                    <span>Up to {MAX_FILE_SIZE_MB} MB each</span>
                </label>

                {selectedFiles.length > 0 && (
                    <p className="derived-title">
                        {selectedFiles.map((file) => titleFromFileName(file.name)).join(', ')}
                    </p>
                )}

                <label className="form-field">
                    <span>Artist <em>optional</em></span>
                    <input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="Unknown Artist" />
                </label>

                <label className="form-field">
                    <span>Album <em>optional</em></span>
                    <input value={album} onChange={(event) => setAlbum(event.target.value)} placeholder="Single" />
                </label>

                <button className="primary-button" type="submit" disabled={uploading}>
                    {uploading ? 'Uploading...' : 'Upload to library'}
                </button>

                {message && <p className="success-message">{message}</p>}
                {error && <p className="error-message">{error}</p>}
            </form>
        </section>
    )
}
