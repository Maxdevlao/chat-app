"use client";
import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import EmojiPicker from "emoji-picker-react";

const SOCKET_URL = "http://localhost:4000";
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function isImage(mimetype) {
  return mimetype?.startsWith("image/");
}

export default function Chat() {
  const [socket, setSocket]               = useState(null);
  const [username, setUsername]           = useState("");
  const [joined, setJoined]               = useState(false);
  const [messages, setMessages]           = useState([]);
  const [users, setUsers]                 = useState([]);
  const [input, setInput]                 = useState("");
  const [typingUsers, setTypingUsers]     = useState([]);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [reactionTarget, setReactionTarget]   = useState(null); // messageId
  const [reactionsMap, setReactionsMap]   = useState({});       // msgId -> {emoji: [users]}
  const [uploading, setUploading]         = useState(false);
  const [uploadPreview, setUploadPreview] = useState(null);     // { file, url, mimetype }

  const bottomRef      = useRef(null);
  const typingTimeout  = useRef(null);
  const emojiPickerRef = useRef(null);
  const reactionRef    = useRef(null);
  const fileInputRef   = useRef(null);

  // Socket setup
  useEffect(() => {
    const s = io(SOCKET_URL);
    setSocket(s);

    s.on("message", (msg) => {
      setMessages((prev) => [...prev, { type: "message", ...msg }]);
    });
    s.on("system", ({ message }) => {
      setMessages((prev) => [...prev, { type: "system", text: message, id: Date.now() }]);
    });
    s.on("users", (list) => setUsers(list));
    s.on("typing", ({ username }) =>
      setTypingUsers((p) => p.includes(username) ? p : [...p, username])
    );
    s.on("stop_typing", ({ username }) =>
      setTypingUsers((p) => p.filter((u) => u !== username))
    );
    s.on("reactions_update", ({ messageId, reactions }) => {
      setReactionsMap((prev) => ({ ...prev, [messageId]: reactions }));
    });

    return () => s.disconnect();
  }, []);

  // Close popups on outside click
  useEffect(() => {
    const handler = (e) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target))
        setShowEmojiPicker(false);
      if (reactionRef.current && !reactionRef.current.contains(e.target))
        setReactionTarget(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingUsers]);

  const emitTyping = () => {
    if (!socket) return;
    socket.emit("typing");
    clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => socket.emit("stop_typing"), 1500);
  };

  const handleJoin = () => {
    if (!username.trim()) return;
    socket.emit("join", username.trim());
    setJoined(true);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text && !uploadPreview) return;

    socket.emit("message", {
      text,
      file: uploadPreview
        ? { url: uploadPreview.url, originalName: uploadPreview.name,
            mimetype: uploadPreview.mimetype, size: uploadPreview.size }
        : null,
    });

    clearTimeout(typingTimeout.current);
    socket.emit("stop_typing");
    setInput("");
    setUploadPreview(null);
    setShowEmojiPicker(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") joined ? handleSend() : handleJoin();
  };

  // File selection & upload to backend
  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${SOCKET_URL}/upload`, { method: "POST", body: formData });
      const data = await res.json();
      setUploadPreview({
        url: data.url,
        name: data.originalName,
        mimetype: data.mimetype,
        size: data.size,
        localUrl: isImage(data.mimetype) ? URL.createObjectURL(file) : null,
      });
    } catch (err) {
      alert("Upload failed: " + err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const handleReact = (messageId, emoji) => {
    socket.emit("react", { messageId, emoji });
    setReactionTarget(null);
  };

  if (!joined) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="bg-gray-900 p-8 rounded-2xl shadow-2xl w-full max-w-sm">
          <h1 className="text-2xl font-bold text-white mb-6 text-center">💬 Join Chat</h1>
          <input
            className="w-full bg-gray-800 text-white rounded-lg px-4 py-3 mb-4 outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Enter your username..."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button onClick={handleJoin}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3 rounded-lg transition">
            Join
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-950 text-white">

      {/* Sidebar */}
      <aside className="w-52 bg-gray-900 p-4 hidden md:flex flex-col">
        <h2 className="text-sm font-semibold text-gray-400 uppercase mb-3">
          Online ({users.length})
        </h2>
        <ul className="space-y-2">
          {users.map((u, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
              <span className={u === username ? "text-indigo-400 font-semibold" : "text-gray-300"}>{u}</span>
            </li>
          ))}
        </ul>
      </aside>

      {/* Main Chat */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <header className="bg-gray-900 px-6 py-4 border-b border-gray-800 font-bold text-lg">
          💬 Chat Room
        </header>

        {/* Messages */}
        <main className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.map((msg) =>
            msg.type === "system" ? (
              <div key={msg.id} className="text-center text-gray-500 text-xs py-1">
                {msg.text}
              </div>
            ) : (
              <div key={msg.id}
                className={`group flex flex-col max-w-sm relative ${
                  msg.username === username ? "ml-auto items-end" : "items-start"
                }`}
              >
                <span className="text-xs text-gray-400 mb-1">{msg.username}</span>

                <div className="relative">
                  {/* Message bubble */}
                  <div className={`px-4 py-2 rounded-2xl text-sm ${
                    msg.username === username
                      ? "bg-indigo-600 text-white rounded-br-sm"
                      : "bg-gray-800 text-gray-100 rounded-bl-sm"
                  }`}>
                    {/* Text */}
                    {msg.text && <p>{msg.text}</p>}

                    {/* File/Image attachment */}
                    {msg.file && (
                      <div className="mt-2">
                        {isImage(msg.file.mimetype) ? (
                          <a href={msg.file.url} target="_blank" rel="noopener noreferrer">
                            <img
                              src={msg.file.url}
                              alt={msg.file.originalName}
                              className="max-w-xs max-h-60 rounded-lg object-cover cursor-pointer hover:opacity-90 transition"
                            />
                          </a>
                        ) : (
                          <a href={msg.file.url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-2 bg-black/20 rounded-lg px-3 py-2 hover:bg-black/30 transition">
                            <span className="text-xl">📎</span>
                            <div>
                              <p className="text-xs font-medium truncate max-w-[180px]">
                                {msg.file.originalName}
                              </p>
                              <p className="text-xs opacity-60">{formatBytes(msg.file.size)}</p>
                            </div>
                          </a>
                        )}
                      </div>
                    )}
                  </div>

                  {/* 👇 Reaction button — appears on hover */}
                  <button
                    onClick={() => setReactionTarget(reactionTarget === msg.id ? null : msg.id)}
                    className="absolute -top-2 -right-7 opacity-0 group-hover:opacity-100 transition text-base bg-gray-800 rounded-full w-6 h-6 flex items-center justify-center hover:bg-gray-700"
                    title="React"
                  >
                    😄
                  </button>

                  {/* 👇 Quick reaction picker */}
                  {reactionTarget === msg.id && (
                    <div ref={reactionRef}
                      className="absolute z-50 bottom-full mb-2 right-0 bg-gray-800 border border-gray-700 rounded-2xl px-3 py-2 flex gap-2 shadow-xl"
                    >
                      {QUICK_REACTIONS.map((emoji) => (
                        <button key={emoji} onClick={() => handleReact(msg.id, emoji)}
                          className="text-xl hover:scale-125 transition-transform">
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 👇 Reaction counts */}
                {reactionsMap[msg.id] && Object.keys(reactionsMap[msg.id]).length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {Object.entries(reactionsMap[msg.id]).map(([emoji, reactors]) =>
                      reactors.length > 0 ? (
                        <button key={emoji}
                          onClick={() => handleReact(msg.id, emoji)}
                          title={reactors.join(", ")}
                          className={`flex items-center gap-1 text-xs rounded-full px-2 py-0.5 border transition ${
                            reactors.includes(username)
                              ? "bg-indigo-600/30 border-indigo-500 text-indigo-300"
                              : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500"
                          }`}
                        >
                          <span>{emoji}</span>
                          <span>{reactors.length}</span>
                        </button>
                      ) : null
                    )}
                  </div>
                )}
              </div>
            )
          )}

          {/* Typing indicator */}
          {typingUsers.length > 0 && (
            <div className="flex items-center gap-2 text-gray-400 text-xs px-2">
              <div className="flex gap-1">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
              <span>
                {typingUsers.length === 1
                  ? `${typingUsers[0]} is typing...`
                  : `${typingUsers.join(", ")} are typing...`}
              </span>
            </div>
          )}

          <div ref={bottomRef} />
        </main>

        {/* Footer */}
        <footer className="p-4 bg-gray-900 border-t border-gray-800">

          {/* Emoji Picker */}
          {showEmojiPicker && (
            <div ref={emojiPickerRef} className="absolute bottom-24 left-4 md:left-56 z-50">
              <EmojiPicker
                onEmojiClick={(e) => {
                  setInput((prev) => prev + e.emoji);
                  emitTyping();
                }}
                theme="dark"
                height={400}
                width={320}
              />
            </div>
          )}

          {/* File preview */}
          {uploadPreview && (
            <div className="mb-3 flex items-center gap-3 bg-gray-800 rounded-xl px-3 py-2">
              {uploadPreview.localUrl ? (
                <img src={uploadPreview.localUrl} className="w-12 h-12 object-cover rounded-lg" />
              ) : (
                <span className="text-2xl">📎</span>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{uploadPreview.name}</p>
                <p className="text-xs text-gray-400">{formatBytes(uploadPreview.size)}</p>
              </div>
              <button onClick={() => setUploadPreview(null)}
                className="text-gray-400 hover:text-red-400 transition text-lg leading-none">
                ✕
              </button>
            </div>
          )}

          <div className="flex gap-2 items-center">
            {/* Emoji button */}
            <button
              onClick={() => setShowEmojiPicker((p) => !p)}
              className={`text-xl p-2 rounded-lg transition ${
                showEmojiPicker ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              😊
            </button>

            {/* 👇 File attach button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-xl p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition disabled:opacity-50"
              title="Attach file"
            >
              {uploading ? "⏳" : "📎"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf,.txt,.zip"
              className="hidden"
              onChange={handleFileChange}
            />

            {/* Message input */}
            <input
              className="flex-1 bg-gray-800 rounded-lg px-4 py-2 outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              placeholder="Type a message..."
              value={input}
              onChange={(e) => { setInput(e.target.value); emitTyping(); }}
              onKeyDown={handleKeyDown}
            />

            <button
              onClick={handleSend}
              disabled={!input.trim() && !uploadPreview}
              className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-5 py-2 rounded-lg font-semibold transition text-sm"
            >
              Send
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}