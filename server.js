require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.get('/groq-token', (req, res) => {
  res.json({ token: process.env.GROQ_API_KEY });
});

app.listen(3000, () => console.log('Proxy server running on port 3000'));