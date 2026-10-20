import crypto from 'node:crypto'
import http from 'node:http'
import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import multer from 'multer'
import mongoose from 'mongoose'
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { Server } from 'socket.io'
import { r2Client } from './r2.js'
import { connectDB } from './db.js'
import Song from './models/Song.js'

dotenv.config()

const app = express()
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, callback) => {
        if (file.mimetype === 'audio/mpeg') {
            callback(null, true)
            return
        }

        callback(new Error('Only MP3 files are allowed.'))
    }
})

const frontendOrigins = process.env.FRONTEND_ORIGINS
    ? process.env.FRONTEND_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
    : '*'

app.use(cors({ origin: frontendOrigins }))
app.use(express.json())
const server = http.createServer(app)

const io = new Server(server, {
    cors: {
        origin: frontendOrigins,
        methods: ["GET", "POST"]
    }
})
const PORT = process.env.PORT || 3000

app.get('/', (req, res) => { res.send('running') })

app.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running'
    })
})

app.get('/songs', async (req, res) => {
    try {
        const songs = await Song.find()
        return res.json({ success: true, songs })
    } catch (error) {
        console.error('Failed to retrieve songs:', error.message)
        return res.status(500).json({ success: false, message: 'Failed to retrieve songs.' })
    }
})

app.patch('/songs/:id/favorite', async (req, res) => {
    const { id: songId } = req.params

    if (!mongoose.Types.ObjectId.isValid(songId)) {
        return res.status(400).json({ success: false, message: 'Invalid song ID.' })
    }

    if (typeof req.body?.isFavorite !== 'boolean') {
        return res.status(400).json({ success: false, message: 'isFavorite must be a boolean.' })
    }

    try {
        const song = await Song.findById(songId)
        if (!song) {
            return res.status(404).json({ success: false, message: 'Song not found.' })
        }

        song.isFavorite = req.body.isFavorite
        await song.save()

        return res.json({ success: true, song })
    } catch (error) {
        console.error('Failed to update song favourite:', error.message)
        return res.status(500).json({ success: false, message: 'Failed to update favourite status.' })
    }
})

function parseRangeHeader(rangeHeader, totalSize) {
    if (!rangeHeader) return null

    if (!rangeHeader.startsWith('bytes=') || rangeHeader.slice(6).includes(',')) {
        return { invalid: true }
    }

    const rangeValues = rangeHeader.slice(6).split('-')
    if (rangeValues.length !== 2) {
        return { invalid: true }
    }

    const [startValue, endValue] = rangeValues

    let start
    let end

    if (startValue === '') {
        if (!/^\d+$/.test(endValue) || Number(endValue) === 0) {
            return { invalid: true }
        }

        const suffixLength = Number(endValue)
        start = Math.max(totalSize - suffixLength, 0)
        end = totalSize - 1
    } else {
        if (!/^\d+$/.test(startValue)) return { invalid: true }

        start = Number(startValue)
        end = endValue === '' ? totalSize - 1 : Number(endValue)
        if (endValue !== '' && !/^\d+$/.test(endValue)) return { invalid: true }
    }

    if (totalSize === 0 || start >= totalSize || end < start) {
        return { invalid: true }
    }

    return {
        start,
        end: Math.min(end, totalSize - 1)
    }
}

function isMissingR2Object(error) {
    return error?.name === 'NoSuchKey' || error?.name === 'NotFound' || error?.$metadata?.httpStatusCode === 404
}

app.get('/songs/:id/stream', async (req, res) => {
    const { id: songId } = req.params

    if (!mongoose.Types.ObjectId.isValid(songId)) {
        return res.status(400).json({ success: false, message: 'Invalid song ID.' })
    }

    let song
    try {
        song = await Song.findById(songId)
    } catch (error) {
        console.error('Failed to find song for streaming:', error.message)
        return res.status(500).json({ success: false, message: 'Failed to load song.' })
    }

    if (!song) {
        return res.status(404).json({ success: false, message: 'Song not found.' })
    }

    let objectMetadata
    try {
        objectMetadata = await r2Client.send(new HeadObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: song.r2Key
        }))
    } catch (error) {
        if (isMissingR2Object(error)) {
            console.error(`R2 object missing for song ${songId}: ${song.r2Key}`)
            return res.status(404).json({ success: false, message: 'Song file not found in storage.' })
        }

        console.error('Failed to read R2 object metadata:', error.message)
        return res.status(502).json({ success: false, message: 'Failed to access song storage.' })
    }

    const totalSize = Number(objectMetadata.ContentLength)
    if (!Number.isSafeInteger(totalSize) || totalSize < 0) {
        console.error(`Invalid R2 object size for song ${songId}`)
        return res.status(502).json({ success: false, message: 'Invalid song file metadata.' })
    }

    const range = parseRangeHeader(req.headers.range, totalSize)
    if (range?.invalid) {
        res.set('Accept-Ranges', 'bytes')
        res.set('Content-Range', `bytes */${totalSize}`)
        return res.status(416).json({ success: false, message: 'Requested byte range is not satisfiable.' })
    }

    const getObjectInput = {
        Bucket: process.env.R2_BUCKET_NAME,
        Key: song.r2Key
    }

    if (range) {
        getObjectInput.Range = `bytes=${range.start}-${range.end}`
    }

    let object
    try {
        object = await r2Client.send(new GetObjectCommand(getObjectInput))
    } catch (error) {
        if (isMissingR2Object(error)) {
            console.error(`R2 object disappeared while streaming song ${songId}: ${song.r2Key}`)
            return res.status(404).json({ success: false, message: 'Song file not found in storage.' })
        }

        console.error('Failed to retrieve R2 audio stream:', error.message)
        return res.status(502).json({ success: false, message: 'Failed to stream song.' })
    }

    if (!object.Body || typeof object.Body.pipe !== 'function') {
        console.error(`R2 did not return a readable stream for song ${songId}`)
        return res.status(502).json({ success: false, message: 'Failed to stream song.' })
    }

    const responseStart = range?.start ?? 0
    const responseEnd = range?.end ?? totalSize - 1
    const contentLength = responseEnd - responseStart + 1

    res.status(range ? 206 : 200)
    res.set({
        'Accept-Ranges': 'bytes',
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(contentLength)
    })

    if (range) {
        res.set('Content-Range', `bytes ${responseStart}-${responseEnd}/${totalSize}`)
    }

    object.Body.on('error', (error) => {
        console.error('R2 audio stream failed:', error.message)
        if (!res.headersSent) {
            res.status(502).json({ success: false, message: 'Failed to stream song.' })
        } else {
            res.destroy(error)
        }
    })

    res.on('close', () => {
        if (!res.writableEnded && typeof object.Body.destroy === 'function') {
            object.Body.destroy()
        }
    })

    object.Body.pipe(res)
})

app.post('/upload', upload.array('song', 50), async (req, res, next) => {
    if (!req.files?.length) {
        return res.status(400).json({ success: false, message: 'No song files were uploaded.' })
    }

    if (req.files.some((file) => file.mimetype !== 'audio/mpeg')) {
        return res.status(400).json({ success: false, message: 'Only MP3 files are allowed.' })
    }

    const artist = typeof req.body.artist === 'string' ? req.body.artist.trim() : ''
    const album = typeof req.body.album === 'string' ? req.body.album.trim() : ''
    const files = req.files.map((file) => ({
        file,
        title: file.originalname.trim().replace(/\.mp3$/i, '').trim(),
        r2Key: `songs/${crypto.randomUUID()}.mp3`
    }))

    if (files.some(({ title }) => !title)) {
        return res.status(400).json({ success: false, message: 'Song title is required.' })
    }

    try {
        await Promise.all(files.map(({ file, r2Key }) => r2Client.send(new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: r2Key,
            Body: file.buffer,
            ContentType: 'audio/mpeg'
        }))))
    } catch (error) {
        console.error('R2 upload failed:', error.message)
        await Promise.all(files.map(({ r2Key }) => r2Client.send(new DeleteObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: r2Key
        })).catch((cleanupError) => console.error('R2 cleanup failed:', cleanupError.message))))
        return res.status(502).json({ success: false, message: 'Failed to upload the song to storage.' })
    }

    try {
        const songs = await Song.create(files.map(({ file, title, r2Key }) => ({
            title,
            artist: artist || undefined,
            album: album || null,
            r2Key,
            originalFileName: file.originalname,
            fileSize: file.size
        })))

        return res.status(201).json({
            success: true,
            message: 'Songs uploaded successfully',
            songs,
            song: songs[0]
        })
    } catch (error) {
        await Promise.all(files.map(({ r2Key }) => r2Client.send(new DeleteObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: r2Key
            })).catch((cleanupError) => console.error('R2 cleanup failed:', cleanupError.message))))

        console.error('Failed to save song metadata:', error.message)
        return res.status(500).json({ success: false, message: 'Failed to save song metadata.' })
    }
})

const playbackState = {
    currentSongId: null,
    isPlaying: false,
    position: 0,
    updatedAt: Date.now()
}

function broadcastPlaybackState() {
    io.emit('playback_state', { ...playbackState })
}

io.on('connection', (socket) => {
    console.log('[SOCKET] Client connected:', socket.id)
    socket.emit('playback_state', { ...playbackState })

    socket.on('disconnect', (reason) => {
        console.log('[SOCKET] Client disconnected:', socket.id, reason)
    })

    socket.on('change_current_song', (data) => {
        const songId = typeof data === 'string' ? data : data?.songId || data?._id
        if (!songId) return

        console.log('[SOCKET] Received song change:', songId, 'from', socket.id)
        playbackState.currentSongId = songId
        playbackState.isPlaying = false
        playbackState.position = 0
        playbackState.updatedAt = Date.now()
        console.log('[SOCKET] Broadcasting song change:', songId)
        broadcastPlaybackState()
    })

    socket.on('pause', (data) => {
        console.log('[SOCKET] Received pause:', data, 'from', socket.id)
        const position = Number.isFinite(Number(data?.position)) ? Number(data.position) : playbackState.position
        if (data?.songId) playbackState.currentSongId = data.songId
        playbackState.isPlaying = false
        playbackState.position = position
        playbackState.updatedAt = Date.now()
        console.log('[SOCKET] Broadcasting pause:', position)
        broadcastPlaybackState()
    })

    socket.on('play', (data) => {
        console.log('[SOCKET] Received play:', data, 'from', socket.id)
        const position = Number.isFinite(Number(data?.position)) ? Number(data.position) : playbackState.position
        if (data?.songId) playbackState.currentSongId = data.songId
        playbackState.isPlaying = true
        playbackState.position = position
        playbackState.updatedAt = Date.now()
        console.log('[SOCKET] Broadcasting play:', position)
        broadcastPlaybackState()
    })

    socket.on('seek', (data) => {
        console.log('[SOCKET] Received seek:', data, 'from', socket.id)
        const position = Number.isFinite(Number(data?.position)) ? Number(data.position) : playbackState.position
        if (data?.songId) playbackState.currentSongId = data.songId
        playbackState.position = position
        playbackState.updatedAt = Date.now()
        console.log('[SOCKET] Broadcasting seek:', position)
        broadcastPlaybackState()
    })
})

app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        const message = error.code === 'LIMIT_FILE_SIZE'
            ? 'File size must be 20 MB or less.'
            : error.message
        return res.status(400).json({ success: false, message })
    }

    if (error.message === 'Only MP3 files are allowed.') {
        return res.status(400).json({ success: false, message: error.message })
    }

    console.error(error)
    return res.status(500).json({ success: false, message: 'An error occurred while uploading the song.' })
})

async function startServer() {
    await connectDB()
    server.listen(PORT, () => { console.log(`http://localhost:${PORT}`) })
}

startServer()