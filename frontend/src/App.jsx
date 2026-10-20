import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { fetchSongs, SOCKET_URL, updateSongFavorite } from './api.js'
import MusicPlayer from './components/MusicPlayer.jsx'
import SongLibrary from './components/SongLibrary.jsx'
import UploadSong from './components/UploadSong.jsx'

export default function App() {
    const [songs, setSongs] = useState([])
    const [currentSong, setCurrentSong] = useState(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [loadingSongs, setLoadingSongs] = useState(true)
    const [songsError, setSongsError] = useState('')
    const [favoriteError, setFavoriteError] = useState('')
    const [favoriteUpdatingId, setFavoriteUpdatingId] = useState(null)
    const [remotePlaybackCommand, setRemotePlaybackCommand] = useState(null)
    const songsRef = useRef([])
    const socketRef = useRef(null)
    const pendingPlaybackStateRef = useRef(null)

    songsRef.current = songs

    useEffect(() => {
        let cancelled = false

        async function loadSongs() {
            setLoadingSongs(true)
            setSongsError('')

            try {
                const loadedSongs = await fetchSongs()
                if (!cancelled) {
                    setSongs(loadedSongs)

                    const pendingState = pendingPlaybackStateRef.current
                    const pendingSong = loadedSongs.find((song) => song._id === pendingState?.currentSongId)
                    if (pendingSong) {
                        pendingPlaybackStateRef.current = null
                        setCurrentSong(pendingSong)
                        setRemotePlaybackCommand({
                            type: pendingState.isPlaying ? 'play' : 'pause',
                            songId: pendingState.currentSongId,
                            position: pendingState.position
                        })
                    }
                }
            } catch (error) {
                console.error('Failed to load songs:', error)
                if (!cancelled) setSongsError(error instanceof Error ? error.message : 'Failed to load songs.')
            } finally {
                if (!cancelled) setLoadingSongs(false)
            }
        }

        loadSongs()

        return () => {
            cancelled = true
        }
    }, [])

    useEffect(() => {
        const socket = io(SOCKET_URL)
        socketRef.current = socket

        socket.on('connect', () => {
            console.log('[SOCKET] Connected:', socket.id)
        })

        socket.on('disconnect', (reason) => {
            console.log('[SOCKET] Disconnected:', reason)
        })

        socket.on('connect_error', (error) => {
            console.error('[SOCKET] Connection error:', error.message)
        })

        socket.on('playback_state', (state) => {
            console.log('[SOCKET] Received playback state:', state)
            const remoteSong = songsRef.current.find((song) => song._id === state?.currentSongId)
            if (!remoteSong) {
                pendingPlaybackStateRef.current = state
                return
            }

            setCurrentSong(remoteSong)
            setRemotePlaybackCommand({
                type: state.isPlaying ? 'play' : 'pause',
                songId: state.currentSongId,
                position: state.position
            })
        })

        return () => {
            socket.disconnect()
            socketRef.current = null
        }
    }, [])

    function selectSong(song, announce = true) {
        setCurrentSong(song)

        if (announce && socketRef.current?.connected) {
            console.log('[SOCKET] Emitting song change:', song._id)
            socketRef.current.emit('change_current_song', song._id)
        }
    }

    function handleSongUploaded(uploadedSongs) {
        setSongs((previousSongs) => [
            ...uploadedSongs,
            ...previousSongs.filter((song) => !uploadedSongs.some((item) => item._id === song._id))
        ])
        selectSong(uploadedSongs[0])
    }

    async function handleFavoriteChange(song) {
        const previousFavorite = Boolean(song.isFavorite)
        const nextFavorite = !previousFavorite
        setFavoriteError('')
        setFavoriteUpdatingId(song._id)
        setSongs((previousSongs) => previousSongs.map((item) => (
            item._id === song._id ? { ...item, isFavorite: nextFavorite } : item
        )))

        try {
            const updatedSong = await updateSongFavorite(song._id, nextFavorite)
            setSongs((previousSongs) => previousSongs.map((item) => (
                item._id === updatedSong._id ? updatedSong : item
            )))
            setCurrentSong((current) => current?._id === updatedSong._id ? updatedSong : current)
        } catch (error) {
            setSongs((previousSongs) => previousSongs.map((item) => (
                item._id === song._id ? { ...item, isFavorite: previousFavorite } : item
            )))
            setFavoriteError(error instanceof Error ? error.message : 'Failed to update favourite status.')
        } finally {
            setFavoriteUpdatingId(null)
        }
    }

    function emitPlaybackEvent(event, position) {
        if (!socketRef.current?.connected || !currentSong?._id) return

        const payload = {
            songId: currentSong._id,
            position,
            timestamp: Date.now()
        }
        console.log(`[SOCKET] Emitting ${event}:`, payload)
        socketRef.current.emit(event, payload)
    }

    const normalizedQuery = searchQuery.trim().toLowerCase()
    const filteredSongs = songs.filter((song) => {
        if (!normalizedQuery) return true

        return [song.title, song.artist, song.album]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(normalizedQuery))
    }).map((song, index) => ({ song, index }))
        .sort((left, right) => {
            const favoriteOrder = Number(Boolean(right.song.isFavorite)) - Number(Boolean(left.song.isFavorite))
            if (favoriteOrder !== 0) return favoriteOrder

            const titleOrder = (left.song.title || '').localeCompare(right.song.title || '', undefined, { sensitivity: 'base' })
            return titleOrder || left.index - right.index
        })
        .map(({ song }) => song)

    return (
        <main className="app-shell">
            <header className="app-header">
                <div className="brand-lockup">
                    <span className="brand-mark" aria-hidden="true">◒</span>
                    <div>
                        <p className="brand-name">Harmo</p>
                        <p className="brand-tagline">A shared room for every song</p>
                    </div>
                </div>
                {/* <div className="connection-pill">
                    <span className={`status-dot${socketConnected ? ' online' : ''}`} />
                    {socketConnected ? 'Connected' : 'Connecting'}
                </div> */}
            </header>

            {/* <section className="intro-block">
                <p className="eyebrow">The listening room</p>
                <h1>Bring the room<br /><span>into rhythm.</span></h1>
                <p className="intro-copy">Build the shared queue now. Real-time playback will plug into the same song identity when streaming is ready.</p>
            </section> */}

            <div className="content-grid">
                <SongLibrary
                    songs={filteredSongs}
                    selectedSongId={currentSong?._id}
                    searchQuery={searchQuery}
                    onSearchChange={setSearchQuery}
                    onSelectSong={selectSong}
                    onFavoriteChange={handleFavoriteChange}
                    favoriteUpdatingId={favoriteUpdatingId}
                    loading={loadingSongs}
                    error={songsError}
                    favoriteError={favoriteError}
                />
                <UploadSong onSongUploaded={handleSongUploaded} />
            </div>

            <MusicPlayer
                key={currentSong?._id || 'empty-player'}
                song={currentSong}
                remotePlaybackCommand={remotePlaybackCommand}
                onLocalPlay={(position) => emitPlaybackEvent('play', position)}
                onLocalPause={(position) => emitPlaybackEvent('pause', position)}
                onLocalSeek={(position) => emitPlaybackEvent('seek', position)}
            />
        </main>
    )
}
