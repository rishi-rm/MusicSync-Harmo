import mongoose from 'mongoose'

const songSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    artist: {
        type: String,
        default: 'Unknown Artist',
        trim: true
    },
    album: {
        type: String,
        default: null,
        trim: true
    },
    r2Key: {
        type: String,
        required: true,
        unique: true
    },
    originalFileName: {
        type: String,
        required: true
    },
    fileSize: {
        type: Number,
        required: true
    },
    playCount: {
        type: Number,
        default: 0
    },
    isFavorite: {
        type: Boolean,
        default: false
    }
}, { timestamps: true })

const Song = mongoose.model('Song', songSchema)

export default Song