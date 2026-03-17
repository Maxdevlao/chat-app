const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const { randomUUID } = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

// Serve uploaded files statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// Multer storage config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf|txt|zip|mp4/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext || mime);
  },
});

// Create uploads folder if missing
const fs = require("fs");
if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

// File upload REST endpoint
app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  res.json({
    url: `http://localhost:4000/uploads/${req.file.filename}`,
    originalName: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "http://localhost:3000", methods: ["GET", "POST"] },
});

const users = {};      // socketId -> username
const reactions = {};  // messageId -> { emoji: [usernames] }

io.on("connection", (socket) => {
  console.log(`✅ Connected: ${socket.id}`);

  socket.on("join", (username) => {
    users[socket.id] = username;
    io.emit("system", { message: `${username} joined the chat` });
    io.emit("users", Object.values(users));
  });

  socket.on("message", ({ text, file }) => {
    const username = users[socket.id] || "Anonymous";
    const msgId = randomUUID();
    io.emit("message", {
      id: msgId,
      username,
      text,
      file: file || null,   // { url, originalName, mimetype, size }
      timestamp: new Date().toISOString(),
    });
  });

  // 👇 Reactions
  socket.on("react", ({ messageId, emoji }) => {
    const username = users[socket.id];
    if (!username) return;

    if (!reactions[messageId]) reactions[messageId] = {};
    if (!reactions[messageId][emoji]) reactions[messageId][emoji] = [];

    const users_reacted = reactions[messageId][emoji];
    const idx = users_reacted.indexOf(username);

    // Toggle: add if not there, remove if already reacted
    if (idx === -1) {
      users_reacted.push(username);
    } else {
      users_reacted.splice(idx, 1);
      if (users_reacted.length === 0) delete reactions[messageId][emoji];
    }

    io.emit("reactions_update", {
      messageId,
      reactions: reactions[messageId],
    });
  });

  socket.on("typing", () => {
    const username = users[socket.id];
    if (username) socket.broadcast.emit("typing", { username });
  });

  socket.on("stop_typing", () => {
    const username = users[socket.id];
    if (username) socket.broadcast.emit("stop_typing", { username });
  });

  socket.on("disconnect", () => {
    const username = users[socket.id];
    delete users[socket.id];
    if (username) {
      io.emit("system", { message: `${username} left the chat` });
      io.emit("users", Object.values(users));
    }
  });
});

server.listen(4000, () => console.log("🚀 Server on http://localhost:4000"));