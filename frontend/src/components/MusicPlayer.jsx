import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { API_BASE_URL } from '../api.js'

function formatTime(seconds) {
    if (!Number.isFinite(seconds)) return '0:00'

    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60).toString().padStart(2, '0')
    return `${minutes}:${remainingSeconds}`
}

const MusicPlayer = forwardRef(function MusicPlayer({ song, playRequestId, remotePlaybackCommand, onSongEnded, onLocalPlay, onLocalPause, onLocalSeek }, ref) {
    const audioRef = useRef(null)
    const activeSongRef = useRef(song)
    const sourceSongIdRef = useRef(null)
    const attemptIdRef = useRef(0)
    const inFlightSongIdRef = useRef(null)
    const isPlayingRef = useRef(false)
    const pendingRemotePlaybackRef = useRef(null)
    const pendingRemoteSeekRef = useRef(null)
    const blockedSongIdRef = useRef(null)
    const onLocalPlayRef = useRef(onLocalPlay)
    const onLocalPauseRef = useRef(onLocalPause)
    const onLocalSeekRef = useRef(onLocalSeek)
    const onSongEndedRef = useRef(onSongEnded)
    const [isPlaying, setIsPlaying] = useState(false)
    const [isBuffering, setIsBuffering] = useState(false)
    const [currentTime, setCurrentTime] = useState(0)
    const [duration, setDuration] = useState(0)
    const [playbackError, setPlaybackError] = useState(null)

    useEffect(() => {
        onLocalPlayRef.current = onLocalPlay
        onLocalPauseRef.current = onLocalPause
        onLocalSeekRef.current = onLocalSeek
        onSongEndedRef.current = onSongEnded
    }, [onLocalPause, onLocalPlay, onLocalSeek, onSongEnded])

    const requestPlayback = useCallback((nextSong, { announce = true } = {}) => {
        const audio = audioRef.current
        if (!audio || !nextSong?._id) return

        const isNewTrack = sourceSongIdRef.current !== nextSong._id
        activeSongRef.current = nextSong

        if (isNewTrack) {
            attemptIdRef.current += 1
            inFlightSongIdRef.current = null
            pendingRemotePlaybackRef.current = null
            pendingRemoteSeekRef.current = null
            audio.pause()
            audio.currentTime = 0
            sourceSongIdRef.current = nextSong._id
            audio.src = `${API_BASE_URL}/songs/${encodeURIComponent(nextSong._id)}/stream`
            audio.load()
            setCurrentTime(0)
            setDuration(0)
            isPlayingRef.current = false
            setIsPlaying(false)
        } else if (isPlayingRef.current || inFlightSongIdRef.current === nextSong._id) {
            return
        }

        const attemptId = ++attemptIdRef.current
        blockedSongIdRef.current = null
        inFlightSongIdRef.current = nextSong._id
        setPlaybackError(null)
        setIsBuffering(true)

        try {
            Promise.resolve(audio.play()).then(() => {
                if (attemptId !== attemptIdRef.current || sourceSongIdRef.current !== nextSong._id) return

                inFlightSongIdRef.current = null
                setIsBuffering(false)
                if (announce) onLocalPlayRef.current?.(audio.currentTime, nextSong._id)
            }).catch((error) => {
                if (attemptId !== attemptIdRef.current || sourceSongIdRef.current !== nextSong._id) return

                inFlightSongIdRef.current = null
                isPlayingRef.current = false
                setIsPlaying(false)
                setIsBuffering(false)

                if (error?.name === 'NotAllowedError') {
                    blockedSongIdRef.current = nextSong._id
                    setPlaybackError({
                        songId: nextSong._id,
                        blocked: true,
                        message: 'Your browser blocked autoplay. Use Play / Resume to start this track on this device.'
                    })
                    return
                }

                console.error(`Audio playback failed for song ${nextSong._id}:`, error)
                setPlaybackError({
                    songId: nextSong._id,
                    blocked: false,
                    message: 'Unable to play this song. Check your connection and try again.'
                })
            })
        } catch (error) {
            if (attemptId !== attemptIdRef.current || sourceSongIdRef.current !== nextSong._id) return

            inFlightSongIdRef.current = null
            isPlayingRef.current = false
            setIsPlaying(false)
            setIsBuffering(false)

            if (error?.name === 'NotAllowedError') {
                blockedSongIdRef.current = nextSong._id
                setPlaybackError({
                    songId: nextSong._id,
                    blocked: true,
                    message: 'Your browser blocked autoplay. Use Play / Resume to start this track on this device.'
                })
                return
            }

            console.error(`Audio playback failed for song ${nextSong._id}:`, error)
            setPlaybackError({
                songId: nextSong._id,
                blocked: false,
                message: 'Unable to play this song. Check your connection and try again.'
            })
        }
    }, [])

    useImperativeHandle(ref, () => ({
        playSong(nextSong) {
            requestPlayback(nextSong)
        }
    }), [requestPlayback])

    const applyPendingRemoteSeek = useCallback((audio) => {
        const pendingSeek = pendingRemoteSeekRef.current
        if (!pendingSeek || pendingSeek.songId !== sourceSongIdRef.current || audio.readyState < 1) return

        audio.currentTime = pendingSeek.position
        pendingRemoteSeekRef.current = null
    }, [])

    const startPendingRemotePlayback = useCallback(() => {
        const audio = audioRef.current
        const pendingPlayback = pendingRemotePlaybackRef.current
        if (!audio || !pendingPlayback || audio.readyState < 2) return

        pendingRemotePlaybackRef.current = null
        if (blockedSongIdRef.current === pendingPlayback.songId) return

        applyPendingRemoteSeek(audio)
        if (sourceSongIdRef.current === pendingPlayback.songId) {
            requestPlayback(activeSongRef.current, { announce: false })
        }
    }, [applyPendingRemoteSeek, requestPlayback])

    useEffect(() => {
        const audio = audioRef.current
        if (!audio) return undefined

        const handleLoadedMetadata = () => {
            setDuration(audio.duration)
            applyPendingRemoteSeek(audio)
        }
        const handleCanPlay = () => startPendingRemotePlayback()
        const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
        const handleEmptied = () => {
            setCurrentTime(0)
            setDuration(0)
            isPlayingRef.current = false
            setIsPlaying(false)
            if (!inFlightSongIdRef.current) setIsBuffering(false)
        }
        const handlePlaying = () => {
            isPlayingRef.current = true
            setIsPlaying(true)
            setIsBuffering(false)
        }
        const handleWaiting = () => {
            isPlayingRef.current = false
            setIsPlaying(false)
            setIsBuffering(true)
        }
        const handlePause = () => {
            isPlayingRef.current = false
            setIsPlaying(false)
            if (!inFlightSongIdRef.current) setIsBuffering(false)
        }
        const handleEnded = () => {
            isPlayingRef.current = false
            setIsPlaying(false)
            setIsBuffering(false)
            setCurrentTime(0)
            if (activeSongRef.current) onSongEndedRef.current?.(activeSongRef.current)
        }
        const handleError = () => {
            inFlightSongIdRef.current = null
            isPlayingRef.current = false
            setIsPlaying(false)
            setIsBuffering(false)
            console.error(`Audio source failed for song ${sourceSongIdRef.current}:`, audio.error)
            setPlaybackError({
                songId: sourceSongIdRef.current,
                blocked: false,
                message: 'Unable to load this song from storage.'
            })
        }

        audio.addEventListener('loadedmetadata', handleLoadedMetadata)
        audio.addEventListener('emptied', handleEmptied)
        audio.addEventListener('canplay', handleCanPlay)
        audio.addEventListener('timeupdate', handleTimeUpdate)
        audio.addEventListener('playing', handlePlaying)
        audio.addEventListener('waiting', handleWaiting)
        audio.addEventListener('pause', handlePause)
        audio.addEventListener('ended', handleEnded)
        audio.addEventListener('error', handleError)

        return () => {
            attemptIdRef.current += 1
            audio.pause()
            audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
            audio.removeEventListener('emptied', handleEmptied)
            audio.removeEventListener('canplay', handleCanPlay)
            audio.removeEventListener('timeupdate', handleTimeUpdate)
            audio.removeEventListener('playing', handlePlaying)
            audio.removeEventListener('waiting', handleWaiting)
            audio.removeEventListener('pause', handlePause)
            audio.removeEventListener('ended', handleEnded)
            audio.removeEventListener('error', handleError)
        }
    }, [applyPendingRemoteSeek, startPendingRemotePlayback])

    useEffect(() => {
        const audio = audioRef.current
        if (!audio) return

        activeSongRef.current = song
        if (sourceSongIdRef.current === (song?._id ?? null)) return

        attemptIdRef.current += 1
        inFlightSongIdRef.current = null
        pendingRemotePlaybackRef.current = null
        pendingRemoteSeekRef.current = null
        blockedSongIdRef.current = null
        activeSongRef.current = song
        sourceSongIdRef.current = song?._id ?? null
        audio.pause()
        audio.currentTime = 0

        if (song?._id) {
            audio.src = `${API_BASE_URL}/songs/${encodeURIComponent(song._id)}/stream`
        } else {
            audio.removeAttribute('src')
        }
        audio.load()
    }, [song])

    useEffect(() => {
        const audio = audioRef.current
        if (!audio || playRequestId === null || !song?._id) return

        requestPlayback(activeSongRef.current)
    }, [playRequestId, song?._id, requestPlayback])

    useEffect(() => {
        const audio = audioRef.current
        if (!audio || !remotePlaybackCommand || !song?._id) return
        if (remotePlaybackCommand.songId && remotePlaybackCommand.songId !== song._id) return

        const position = Number(remotePlaybackCommand.position)
        if (Number.isFinite(position)) {
            pendingRemoteSeekRef.current = { songId: song._id, position }
            applyPendingRemoteSeek(audio)
        }

        if (remotePlaybackCommand.type === 'play') {
            if (blockedSongIdRef.current === song._id) return
            pendingRemotePlaybackRef.current = { songId: song._id }
            startPendingRemotePlayback()
            return
        }

        pendingRemotePlaybackRef.current = null
        if (remotePlaybackCommand.type === 'pause') {
            attemptIdRef.current += 1
            inFlightSongIdRef.current = null
            audio.pause()
            return
        }

        if (remotePlaybackCommand.type === 'seek') {
            setCurrentTime(audio.currentTime)
        }
    }, [applyPendingRemoteSeek, remotePlaybackCommand, song, startPendingRemotePlayback])

    function handlePlay() {
        if (activeSongRef.current) requestPlayback(activeSongRef.current)
    }

    function handlePause() {
        const audio = audioRef.current
        if (!audio) return

        attemptIdRef.current += 1
        inFlightSongIdRef.current = null
        pendingRemotePlaybackRef.current = null
        audio.pause()
        isPlayingRef.current = false
        setIsPlaying(false)
        setIsBuffering(false)
        onLocalPauseRef.current?.(audio.currentTime, sourceSongIdRef.current)
    }

    function handleSeek(event) {
        const audio = audioRef.current
        if (!audio) return

        const nextTime = Number(event.target.value)
        audio.currentTime = nextTime
        setCurrentTime(nextTime)
    }

    function handleSeekCommit() {
        const audio = audioRef.current
        if (!audio) return

        onLocalSeekRef.current?.(audio.currentTime, sourceSongIdRef.current)
    }

    function handleRestart() {
        const audio = audioRef.current
        if (!audio) return

        audio.currentTime = 0
        setCurrentTime(0)
        onLocalSeekRef.current?.(0, sourceSongIdRef.current)
    }

    function handleEnd() {
        const audio = audioRef.current
        if (!audio || !duration) return

        audio.currentTime = duration
        setCurrentTime(duration)
        onLocalSeekRef.current?.(duration, sourceSongIdRef.current)
    }

    const hasSong = Boolean(song?._id)
    const currentPlaybackError = playbackError?.songId === song?._id ? playbackError : null

    return (
        <section className="player-panel" aria-labelledby="player-heading">
            <audio ref={audioRef} preload="metadata" />
            <div className="player-art" aria-hidden="true">♫</div>
            <div className="player-copy">
                <p className="eyebrow">Now selected</p>
                <h2 id="player-heading">{song ? song.title : 'Choose a song'}</h2>
                <p>{song ? `${song.artist || 'Unknown Artist'}${song.album ? ` · ${song.album}` : ''}` : 'Select a track from your library to prepare playback.'}</p>
            </div>
            <div className="player-progress">
                <span>{formatTime(currentTime)}</span>
                <input
                    aria-label="Seek through song"
                    type="range"
                    min="0"
                    max={duration || 0}
                    step="0.1"
                    value={Math.min(currentTime, duration || 0)}
                    onChange={handleSeek}
                    onMouseUp={handleSeekCommit}
                    onTouchEnd={handleSeekCommit}
                    onKeyUp={handleSeekCommit}
                    disabled={!hasSong || !duration}
                />
                <span>{formatTime(duration)}</span>
            </div>
            <div className="player-controls" aria-label="Playback controls">
                <button type="button" onClick={handleRestart} disabled={!hasSong} aria-label="Restart song">↺</button>
                <button className="play-button" type="button" onClick={isPlaying || isBuffering ? handlePause : handlePlay} disabled={!hasSong} aria-label={isPlaying || isBuffering ? 'Pause song' : 'Play song'}>
                    {isBuffering ? '…' : isPlaying ? 'Ⅱ' : '▶'}
                </button>
                <button type="button" onClick={handleEnd} disabled={!hasSong || !duration} aria-label="End song">↻</button>
            </div>
            {currentPlaybackError && (
                <div className="player-note error-message" role="alert">
                    <span>{currentPlaybackError.message}</span>
                    {currentPlaybackError.blocked && (
                        <button className="resume-button" type="button" onClick={handlePlay}>
                            Play / Resume
                        </button>
                    )}
                </div>
            )}
        </section>
    )
})

export default MusicPlayer
