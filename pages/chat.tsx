import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import io, { Socket } from 'socket.io-client';
import Head from 'next/head';

// Define Message interface
interface Message {
  id?: string;
  text: string;
  from: string;
  isFile?: boolean;
  isEncrypted?: boolean;
  fileContent?: string;
  timestamp?: number;
}

// Define User interface
interface User {
  id: string;
  username: string;
}

// Define Room interface
interface Room {
  id: string;
  name: string;
}

// Simple encryption function
function encrypt(text: string): string {
  return btoa(text);
}

// Simple decryption function
function decrypt(text: string): string {
  return atob(text);
}

export default function Chat() {
  const [users, setUsers] = useState<User[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<{ [key: string]: Message[] }>({});
  const [inputMessage, setInputMessage] = useState('');
  const [newRoomName, setNewRoomName] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const storedUser = localStorage.getItem('user');
    if (!storedUser) {
      router.push('/');
      return;
    }

    const user: User = JSON.parse(storedUser);
    setCurrentUser(user);

    socketRef.current = io('/', {
      query: { userId: user.id, username: user.username },
    });

    // Socket events
    socketRef.current.on('user-list', (userList: User[]) => {
      setUsers(userList.filter((u) => u.id !== user.id));
    });

    socketRef.current.on('room-list', (roomList: Room[]) => {
      setRooms(roomList);
    });

    socketRef.current.on(
      'private-message',
      ({ from, message, isFile, isEncrypted, fileContent, timestamp }) => {
        const decryptedMessage = isEncrypted ? decrypt(message) : message;
        const decryptedFileContent =
          isFile && fileContent ? decrypt(fileContent) : undefined;
        setMessages((prevMessages) => ({
          ...prevMessages,
          [from]: [
            ...(prevMessages[from] || []),
            {
              text: decryptedMessage,
              from,
              isFile,
              isEncrypted,
              fileContent: decryptedFileContent,
              timestamp,
            },
          ],
        }));
      }
    );

    socketRef.current.on(
      'room-message',
      ({ roomId, from, message, isFile, isEncrypted, fileContent, timestamp }) => {
        const decryptedMessage = isEncrypted ? decrypt(message) : message;
        const decryptedFileContent =
          isFile && fileContent ? decrypt(fileContent) : undefined;
        setMessages((prevMessages) => ({
          ...prevMessages,
          [roomId]: [
            ...(prevMessages[roomId] || []),
            {
              text: decryptedMessage,
              from,
              isFile,
              isEncrypted,
              fileContent: decryptedFileContent,
              timestamp,
            },
          ],
        }));
      }
    );

    socketRef.current.on('room-created', (room: Room) => {
      setRooms((prevRooms) => [...prevRooms, room]);
    });

    socketRef.current.on(
      'user-joined-room',
      ({ roomId, username, timestamp }) => {
        setMessages((prevMessages) => ({
          ...prevMessages,
          [roomId]: [
            ...(prevMessages[roomId] || []),
            {
              text: `${username} joined the room`,
              from: 'System',
              timestamp,
            },
          ],
        }));
      }
    );

    socketRef.current.on(
      'group-message-history',
      ({ roomId, messages: historyMessages }) => {
        setMessages((prevMessages) => ({
          ...prevMessages,
          [roomId]: historyMessages.map((msg: any) => ({
            ...msg,
            text: msg.isEncrypted ? decrypt(msg.message) : msg.message,
            fileContent:
              msg.isFile && msg.fileContent ? decrypt(msg.fileContent) : undefined,
          })),
        }));
      }
    );

    return () => {
      socketRef.current?.disconnect();
    };
  }, [router]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputMessage.trim()) {
      const encryptedMessage = encrypt(inputMessage);
      const timestamp = Date.now();

      if (selectedUser) {
        socketRef.current?.emit('private-message', {
          to: selectedUser.id,
          message: encryptedMessage,
          isEncrypted: true,
          timestamp,
        });
        setMessages((prevMessages) => ({
          ...prevMessages,
          [selectedUser.id]: [
            ...(prevMessages[selectedUser.id] || []),
            {
              text: inputMessage,
              from: currentUser?.username || 'You',
              isEncrypted: true,
              timestamp,
            },
          ],
        }));
      } else if (selectedRoom) {
        socketRef.current?.emit('room-message', {
          roomId: selectedRoom.id,
          message: encryptedMessage,
          isEncrypted: true,
          timestamp,
        });
      }

      setInputMessage('');
    }
  };

  const sendFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && (selectedUser || selectedRoom)) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const fileData = event.target?.result as string;
        if (fileData) {
          const encryptedFileName = encrypt(file.name);
          const encryptedFileContent = encrypt(fileData);
          const timestamp = Date.now();

          if (selectedUser) {
            socketRef.current?.emit('private-message', {
              to: selectedUser.id,
              message: encryptedFileName,
              isFile: true,
              isEncrypted: true,
              fileContent: encryptedFileContent,
              timestamp,
            });
          } else if (selectedRoom) {
            socketRef.current?.emit('room-message', {
              roomId: selectedRoom.id,
              message: encryptedFileName,
              isFile: true,
              isEncrypted: true,
              fileContent: encryptedFileContent,
              timestamp,
            });
          }
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const createRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (newRoomName.trim()) {
      socketRef.current?.emit('create-room', { name: newRoomName });
      setNewRoomName('');
    }
  };

  const joinRoom = (room: Room) => {
    socketRef.current?.emit('join-room', { roomId: room.id });
    setSelectedRoom(room);
    setSelectedUser(null);
  };

  const leaveRoom = () => {
    if (selectedRoom) {
      socketRef.current?.emit('leave-room', { roomId: selectedRoom.id });
      setSelectedRoom(null);
      setMessages((prevMessages) => {
        const newMessages = { ...prevMessages };
        delete newMessages[selectedRoom.id];
        return newMessages;
      });
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      <Head>
        <title>Encrypted Chat</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>
      <div className="flex w-full">
  {/* Sidebar */}
  <div className="w-1/4 bg-white shadow-md flex flex-col">
    <div className="p-4 border-b">
      <h2 className="text-xl font-bold">Chat</h2>
    </div>
    <div className="flex-1 overflow-y-auto">
      {/* Users Section */}
      <div>
        <h3 className="p-4 text-lg font-semibold">Users</h3>
        <ul>
          {users.map((user) => (
            <li
              key={user.id}
              className={`p-4 cursor-pointer ${
                selectedUser?.id === user.id ? "bg-gray-200" : ""
              } hover:bg-gray-100`}
              onClick={() => {
                setSelectedUser(user);
                setSelectedRoom(null);
              }}
            >
              {user.username}
            </li>
          ))}
        </ul>
      </div>

      {/* Rooms Section */}
      <div>
        <h3 className="p-4 text-lg font-semibold">Rooms</h3>
        <ul>
          {rooms.map((room) => (
            <li
              key={room.id}
              className={`p-4 cursor-pointer ${
                selectedRoom?.id === room.id ? "bg-gray-200" : ""
              } hover:bg-gray-100`}
              onClick={() => joinRoom(room)}
            >
              {room.name}
            </li>
          ))}
        </ul>
      </div>
    </div>

    {/* Create Room Form */}
    <form
      className="p-4 border-t flex items-center gap-2"
      onSubmit={createRoom}
    >
      <input
        type="text"
        placeholder="New Room Name"
        value={newRoomName}
        onChange={(e) => setNewRoomName(e.target.value)}
        className="flex-1 border p-2 rounded-md"
      />
      <button
        type="submit"
        className="bg-blue-500 text-white px-4 py-2 rounded-md"
      >
        Create
      </button>
    </form>
  </div>

  {/* Chat Window */}
  <div className="flex-1 flex flex-col">
    {/* Header */}
    <div className="p-4 bg-white border-b flex justify-between items-center">
      <h2 className="text-xl font-bold">
        {selectedUser?.username || selectedRoom?.name || "Select a Chat"}
      </h2>
      {selectedRoom && (
        <button
          onClick={leaveRoom}
          className="text-red-500 hover:text-red-700"
        >
          Leave Room
        </button>
      )}
    </div>

    {/* Messages Display */}
    <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
      {messages[selectedUser?.id || selectedRoom?.id || ""]?.map(
        (message, index) => (
          <div
            key={index}
            className={`mb-4 ${
              message.from === currentUser?.username ? "text-right" : ""
            }`}
          >
            <div
              className={`inline-block p-4 rounded-md ${
                message.from === currentUser?.username
                  ? "bg-blue-500 text-white"
                  : "bg-gray-200 text-black"
              }`}
            >
              {message.isFile ? (
                <a
                  href={message.fileContent}
                  download={message.text}
                  className="underline"
                >
                  {message.text}
                </a>
              ) : (
                message.text
              )}
            </div>
            <div className="text-sm text-gray-500 mt-1">
              {message.from} •{" "}
              {new Date(message.timestamp || Date.now()).toLocaleString()}
            </div>
          </div>
        )
      )}
    </div>

    {/* Input Section */}
    <form
      onSubmit={sendMessage}
      className="p-4 bg-white border-t flex items-center gap-2"
    >
      <input
        type="text"
        placeholder="Type your message..."
        value={inputMessage}
        onChange={(e) => setInputMessage(e.target.value)}
        className="flex-1 border p-2 rounded-md"
      />
      <button
        type="submit"
        className="bg-blue-500 text-white px-4 py-2 rounded-md"
      >
        Send
      </button>
      <button
        type="button"
        className="bg-gray-200 px-4 py-2 rounded-md"
        onClick={() => fileInputRef.current?.click()}
      >
        📎
      </button>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        onChange={sendFile}
      />
    </form>
  </div>
</div>

    </div>
  );
}
