import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'

const mocks = vi.hoisted(() => {
    const handlers = {}
    const emitted = []
    const socket = {
        connected: true,
        on(event, callback) {
            handlers[event] = callback
            return this
        },
        emit(...args) {
            emitted.push(args)
        },
        disconnect() {},
        trigger(event, payload) {
            handlers[event]?.(payload)
        }
    }

    return {
        emitted,
        fetchSongs: vi.fn(),
        handlers,
        socket,
        updateSongFavorite: vi.fn()
    }
})

vi.mock('socket.io-client', () => ({
    io: () => mocks.socket
}))

vi.mock('./api.js', () => ({
    API_BASE_URL: 'https://music.example.test',
    SOCKET_URL: 'https://music.example.test',
    fetchSongs: mocks.fetchSongs,
    updateSongFavorite: mocks.updateSongFavorite
}))

const songs = [
    { _id: 'song-1', title: 'First Track', artist: 'Artist One' },
    { _id: 'song-2', title: 'Second Track', artist: 'Artist Two' }
]

function clickSong(title) {
    fireEvent.click(screen.getByText(title).closest('.song-row'))
}

async function renderApp() {
    render(<App />)
    await screen.findByText('First Track')
}

beforeEach(() => {
    mocks.emitted.length = 0
    Object.keys(mocks.handlers).forEach((event) => delete mocks.handlers[event])
    mocks.fetchSongs.mockResolvedValue(songs)
    mocks.updateSongFavorite.mockReset()

    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function pause() {
        this.dispatchEvent(new Event('pause'))
    })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function play() {
        return Promise.resolve().then(() => {
            this.dispatchEvent(new Event('playing'))
        })
    })
})

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

describe('library playback', () => {
    it('calls play synchronously from the library click and plays the selected track', async () => {
        await renderApp()
        const play = vi.mocked(HTMLMediaElement.prototype.play)
        const previousAttempts = play.mock.calls.length

        clickSong('First Track')

        expect(play).toHaveBeenCalledTimes(previousAttempts + 1)
        expect(document.querySelector('audio').src).toContain('/songs/song-1/stream')
        await screen.findByRole('button', { name: 'Pause song' })
        await waitFor(() => {
            expect(mocks.emitted).toContainEqual(['play', expect.objectContaining({ songId: 'song-1' })])
        })
    })

    it('shows a receiver-side Play / Resume action when autoplay is blocked', async () => {
        await renderApp()
        const blockedError = Object.assign(new Error('User activation is required'), { name: 'NotAllowedError' })
        vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValueOnce(blockedError)

        clickSong('First Track')

        expect((await screen.findByRole('alert')).textContent).toContain('Your browser blocked autoplay')
        expect(screen.getByRole('button', { name: 'Play / Resume' })).toBeTruthy()
        expect(mocks.emitted.filter(([event]) => event === 'play')).toHaveLength(0)

        fireEvent.click(screen.getByRole('button', { name: 'Play / Resume' }))

        await screen.findByRole('button', { name: 'Pause song' })
    })

    it('does not retry a blocked remote play for repeated readiness or sync events', async () => {
        await renderApp()
        const audio = document.querySelector('audio')
        Object.defineProperty(audio, 'readyState', { configurable: true, value: 0 })
        const blockedError = Object.assign(new Error('User activation is required'), { name: 'NotAllowedError' })
        vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(blockedError)

        act(() => {
            mocks.socket.trigger('playback_state', {
                currentSongId: 'song-1',
                isPlaying: true,
                position: 12
            })
        })

        expect(vi.mocked(HTMLMediaElement.prototype.play)).not.toHaveBeenCalled()
        Object.defineProperty(audio, 'readyState', { configurable: true, value: 2 })
        fireEvent(audio, new Event('canplay'))

        expect(await screen.findByRole('button', { name: 'Play / Resume' })).toBeTruthy()
        expect(vi.mocked(HTMLMediaElement.prototype.play)).toHaveBeenCalledTimes(1)

        act(() => {
            mocks.socket.trigger('playback_state', {
                currentSongId: 'song-1',
                isPlaying: true,
                position: 12
            })
        })
        fireEvent(audio, new Event('canplay'))

        expect(vi.mocked(HTMLMediaElement.prototype.play)).toHaveBeenCalledTimes(1)
    })

    it('applies remote seek and pause commands without echoing them back', async () => {
        await renderApp()
        const audio = document.querySelector('audio')
        Object.defineProperty(audio, 'readyState', { configurable: true, value: 0 })
        Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 })

        act(() => {
            mocks.socket.trigger('playback_state', {
                currentSongId: 'song-1',
                isPlaying: true,
                position: 14
            })
        })

        Object.defineProperty(audio, 'readyState', { configurable: true, value: 1 })
        fireEvent(audio, new Event('loadedmetadata'))
        expect(audio.currentTime).toBe(14)

        Object.defineProperty(audio, 'readyState', { configurable: true, value: 2 })
        fireEvent(audio, new Event('canplay'))
        await screen.findByRole('button', { name: 'Pause song' })

        act(() => {
            mocks.socket.trigger('playback_state', {
                currentSongId: 'song-1',
                isPlaying: false,
                position: 22
            })
        })

        expect(audio.currentTime).toBe(22)
        await screen.findByRole('button', { name: 'Play song' })
        expect(mocks.emitted.filter(([event]) => ['play', 'pause', 'seek'].includes(event))).toHaveLength(0)
    })

    it('ignores an older play result after a rapid track change', async () => {
        await renderApp()
        const pendingAttempts = []
        vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(function play() {
            const audio = this
            const source = audio.src
            return new Promise((resolve, reject) => {
                pendingAttempts.push({
                    reject,
                    resolve() {
                        if (audio.src === source) audio.dispatchEvent(new Event('playing'))
                        resolve()
                    },
                    source
                })
            })
        })

        clickSong('First Track')
        clickSong('Second Track')

        expect(pendingAttempts).toHaveLength(2)
        expect(pendingAttempts[0].source).toContain('/songs/song-1/stream')
        expect(pendingAttempts[1].source).toContain('/songs/song-2/stream')
        act(() => {
            mocks.socket.trigger('playback_state', {
                currentSongId: 'song-1',
                isPlaying: false,
                position: 0
            })
        })
        expect(screen.getByRole('heading', { name: 'Second Track' })).toBeTruthy()

        await act(async () => {
            pendingAttempts[0].resolve()
            await Promise.resolve()
        })
        await act(async () => {
            pendingAttempts[1].resolve()
            await Promise.resolve()
        })

        await screen.findByRole('button', { name: 'Pause song' })
        expect(mocks.emitted.filter(([event]) => event === 'play')).toEqual([
            ['play', expect.objectContaining({ songId: 'song-2' })]
        ])
    })

    it('keeps pause, resume, seek, and socket synchronization working', async () => {
        await renderApp()
        clickSong('First Track')

        await screen.findByRole('button', { name: 'Pause song' })
        fireEvent.click(screen.getByRole('button', { name: 'Pause song' }))
        await screen.findByRole('button', { name: 'Play song' })
        fireEvent.click(screen.getByRole('button', { name: 'Play song' }))
        await screen.findByRole('button', { name: 'Pause song' })

        const audio = document.querySelector('audio')
        Object.defineProperty(audio, 'duration', { configurable: true, value: 60 })
        Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 })
        fireEvent(audio, new Event('loadedmetadata'))
        const seek = screen.getByRole('slider', { name: 'Seek through song' })
        fireEvent.change(seek, { target: { value: '17.5' } })
        fireEvent.mouseUp(seek)

        expect(mocks.emitted).toContainEqual(['pause', expect.objectContaining({ songId: 'song-1' })])
        expect(mocks.emitted).toContainEqual(['seek', expect.objectContaining({ songId: 'song-1', position: 17.5 })])
        expect(mocks.emitted.filter(([event]) => event === 'play')).toHaveLength(2)
    })
})
