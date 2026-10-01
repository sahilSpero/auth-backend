// src/server.js — combined
const express = require('express');
const { PORT } = require('./config/env');
const connectDB = require('./config/db');
const userRoutes = require('./modules/user/userRoute');
const authRoutes = require('./modules/auth/authRoute');
const extractorRoutes = require('./modules/extractor/extractorRoute');
// const errorMiddleware = require('./middlewares/error.middleware');

const app = express();

app.use(express.json());
app.get('/health', (req, res) => res.json({ success: true }));
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/extract', extractorRoutes);
// app.use(errorMiddleware);

const start = async () => {
  await connectDB();
  app.listen(PORT, () => console.log(`Running on port ${PORT}`));
};

start();