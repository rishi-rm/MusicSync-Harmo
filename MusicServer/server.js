const fs = require('fs');
const path = require('path');
const express = require('express')
const app = express()
const cors = require('cors')

const PORT = 5000

app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
}))

app.use('/music', express.static('D:/GetMusicDownloads'))

app.get("/", (req, res) => res.send("Server running"))

app.get('/songs', (req, res) => {
    const dirPath = 'D:/GetMusicDownloads';
    fs.readdir(dirPath, (err, files) => {
        if (err) return res.status(500).json({ error: 'Unable to read folder' });
        
        const songs = files;
        res.json(songs);
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);

})