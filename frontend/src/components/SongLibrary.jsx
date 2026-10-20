import { useEffect, useRef, useState } from 'react'

function formatDate(dateValue) {
    if (!dateValue) return ''

    return new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
    }).format(new Date(dateValue))
}

export default function SongLibrary({ songs, selectedSongId, searchQuery, onSearchChange, onSelectSong, onFavoriteChange, favoriteUpdatingId, loading, error, favoriteError }) {
    const [openMenuId, setOpenMenuId] = useState(null)
    const menuRef = useRef(null)

    useEffect(() => {
        if (!openMenuId) return undefined

        function closeMenu(event) {
            if (!menuRef.current?.contains(event.target)) setOpenMenuId(null)
        }

        document.addEventListener('mousedown', closeMenu)
        document.addEventListener('touchstart', closeMenu)
        return () => {
            document.removeEventListener('mousedown', closeMenu)
            document.removeEventListener('touchstart', closeMenu)
        }
    }, [openMenuId])

    function selectRow(event, song) {
        if (event.target.closest('[data-song-menu]')) return
        onSelectSong(song)
    }

    function handleRowKeyDown(event, song) {
        if (event.target.closest('[data-song-menu]')) return

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onSelectSong(song)
        }
    }

    return (
        <section className="panel library-panel" aria-labelledby="library-heading">
            <div className="section-heading">
                <div>
                    <p className="eyebrow">Your collection</p>
                    <h2 id="library-heading">Song library</h2>
                </div>
                <span className="count-badge">{songs.length}</span>
            </div>

            <label className="search-field">
                <span className="sr-only">Search in library</span>
                <span aria-hidden="true">⌕</span>
                <input
                    type="search"
                    placeholder="Search in library"
                    value={searchQuery}
                    onChange={(event) => onSearchChange(event.target.value)}
                />
            </label>

            {loading && <p className="state-message">Loading your library...</p>}
            {error && <p className="state-message error-message">{error}</p>}
            {favoriteError && <p className="state-message error-message">{favoriteError}</p>}

            {!loading && !error && songs.length === 0 && (
                <p className="state-message">Your library is empty. Upload an MP3 to get started.</p>
            )}

            {!loading && !error && songs.length > 0 && (
                <div className="song-list">
                    {songs.map((song) => {
                        const isSelected = song._id === selectedSongId
                        const isFavorite = Boolean(song.isFavorite)
                        const isUpdating = favoriteUpdatingId === song._id

                        return (
                            <div
                                className={`song-row${isSelected ? ' selected' : ''}`}
                                key={song._id}
                                role="button"
                                tabIndex="0"
                                onClick={(event) => selectRow(event, song)}
                                onKeyDown={(event) => handleRowKeyDown(event, song)}
                            >
                                <span className={`song-index${isFavorite ? ' favorite' : ''}`} aria-label={isFavorite ? 'Favourite' : undefined}>{isFavorite ? '★' : (isSelected ? '▶' : '♪')}</span>
                                <span className="song-copy">
                                    <strong>{song.title}</strong>
                                    <span>{song.artist || 'Unknown Artist'}</span>
                                </span>
                                <span className="song-meta">
                                    {song.album || 'Single'}
                                    {song.createdAt && <small>{formatDate(song.createdAt)}</small>}
                                </span>
                                <span className="song-menu-wrap" ref={openMenuId === song._id ? menuRef : null} data-song-menu>
                                    <button
                                        className="song-menu-button"
                                        type="button"
                                        aria-label={`Actions for ${song.title}`}
                                        aria-expanded={openMenuId === song._id}
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            setOpenMenuId((currentId) => currentId === song._id ? null : song._id)
                                        }}
                                    >
                                        ⋮
                                    </button>
                                    {openMenuId === song._id && (
                                        <div className="song-menu" role="menu">
                                            <button
                                                type="button"
                                                role="menuitem"
                                                disabled={isUpdating}
                                                onClick={(event) => {
                                                    event.stopPropagation()
                                                    setOpenMenuId(null)
                                                    onFavoriteChange(song)
                                                }}
                                            >
                                                {isFavorite ? '★ Remove from Favourites' : '☆ Mark as Favourite'}
                                            </button>
                                        </div>
                                    )}
                                </span>
                            </div>
                        )
                    })}
                </div>
            )}
        </section>
    )
}
