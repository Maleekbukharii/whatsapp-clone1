const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const next = require('next');
const crypto = require('crypto');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const expressApp = express();
  const server = http.createServer(expressApp);
  const io = new Server(server);

  const connectedUsers = new Map();
  const rooms = new Map();
  const groupMessages = new Map(); // Store group messages

  io.on('connection', (socket) => {
    console.log('A user connected');

    const { userId, username } = socket.handshake.query;
    
    if (userId && username) {
      socket.userId = userId;
      socket.username = username;
      connectedUsers.set(userId, { socketId: socket.id, username });

      // Send updated user list to all connected clients
      const onlineUsers = Array.from(connectedUsers.entries()).map(([id, data]) => ({
        id,
        username: data.username
      }));
      io.emit('user-list', onlineUsers);

      // Send room list and history to the connected user
      socket.emit('room-list', Array.from(rooms.values()));
      
      // Send group message history
      Array.from(groupMessages.entries()).forEach(([roomId, messages]) => {
        socket.emit('group-message-history', { roomId, messages });
      });
    }

    socket.on('private-message', ({ to, message, isFile, isEncrypted, fileContent }) => {
      const recipientSocketId = connectedUsers.get(to)?.socketId;
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('private-message', {
          from: socket.userId,
          message,
          isFile,
          isEncrypted,
          fileContent
        });
      }
    });

    socket.on('create-room', ({ name }) => {
      const roomId = crypto.randomBytes(16).toString('hex');
      const room = { id: roomId, name, members: [socket.userId] };
      rooms.set(roomId, room);
      groupMessages.set(roomId, []); // Initialize empty message history
      io.emit('room-list', Array.from(rooms.values()));
    });

    socket.on('room-message', ({ roomId, message, isFile, isEncrypted, fileContent }) => {
      const room = rooms.get(roomId);
      if (room) {
        const messageObj = {
          id: crypto.randomBytes(16).toString('hex'),
          from: socket.username,
          message,
          isFile,
          isEncrypted,
          fileContent,
          timestamp: Date.now()
        };
        
        // Store message in history
        const roomMessages = groupMessages.get(roomId) || [];
        roomMessages.push(messageObj);
        groupMessages.set(roomId, roomMessages);

        // Broadcast to all room members
        io.to(roomId).emit('room-message', {
          roomId,
          ...messageObj
        });
      }
    });

    socket.on('join-room', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (room && !room.members.includes(socket.userId)) {
        room.members.push(socket.userId);
        socket.join(roomId);
        
        // Send room history to joining user
        const roomMessages = groupMessages.get(roomId) || [];
        socket.emit('group-message-history', { roomId, messages: roomMessages });
        
        // Notify others
        io.to(roomId).emit('user-joined-room', {
          roomId,
          username: socket.username
        });
      }
    });

    socket.on('leave-room', ({ roomId }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.members = room.members.filter(id => id !== socket.userId);
        socket.leave(roomId);
        io.to(roomId).emit('user-left-room', {
          roomId,
          username: socket.username
        });
      }
    });

    socket.on('disconnect', () => {
      if (socket.userId) {
        // Remove user from all rooms
        rooms.forEach((room, roomId) => {
          if (room.members.includes(socket.userId)) {
            room.members = room.members.filter(id => id !== socket.userId);
            io.to(roomId).emit('user-left-room', {
              roomId,
              username: socket.username
            });
          }
        });

        connectedUsers.delete(socket.userId);
        const onlineUsers = Array.from(connectedUsers.entries()).map(([id, data]) => ({
          id,
          username: data.username
        }));
        io.emit('user-list', onlineUsers);
      }
      console.log('A user disconnected');
    });
  });

  expressApp.all('*', (req, res) => {
    return handle(req, res);
  });

  server.listen(3000, (err) => {
    if (err) throw err;
    console.log('> Ready on http://localhost:3000');
  });
});
