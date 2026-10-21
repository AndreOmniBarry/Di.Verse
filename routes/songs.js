const express = require('express');
const router = express.Router();
const { searchSongs, getSongSlides, addSong, addSlide, deleteSong, updateSong } = require('../services/songsDb');

router.get('/songs/search', (req, res) => {
  const { q = '' } = req.query;
  res.json(searchSongs(q));
});

router.get('/songs/:id/slides', (req, res) => {
  res.json(getSongSlides(parseInt(req.params.id)));
});

router.post('/songs', (req, res) => {
  const { title, artist, language = 'English', tags = '' } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  res.json({ id: addSong(title, artist, language, tags) });
});

router.post('/songs/:id/slides', (req, res) => {
  const { section, content, slide_num } = req.body;
  if (!content) return res.status(400).json({ error: 'content is required' });
  res.json({ id: addSlide(parseInt(req.params.id), slide_num, section, content) });
});

router.put('/songs/:id', (req, res) => {
  const { title, artist, language, tags, slides } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!Array.isArray(slides)) return res.status(400).json({ error: 'slides must be an array' });
  updateSong(parseInt(req.params.id), { title, artist, language, tags, slides: slides.filter(sl => sl && sl.content) });
  res.json({ ok: true });
});

router.delete('/songs/:id', (req, res) => {
  deleteSong(parseInt(req.params.id));
  res.json({ ok: true });
});

module.exports = router;