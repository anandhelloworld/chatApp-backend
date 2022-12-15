import express from "express";
import { Server } from "socket.io";
import dotenv from "dotenv";
import cors from "cors";
import http from "http";
import { MongoClient } from "mongodb";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcrypt";

const app = express();

dotenv.config();

app.use(express.json());
const PORT = process.env.PORT||8000;
const MONGO_URL = process.env.MONGO_URL||"mongodb+srv://anand:TmF7ogJ1ALhcWFxO@allproject.p2rbwnr.mongodb.net/?retryWrites=true&w=majority";

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "https://chat-cok4.onrender.com", methods: ["GET", "POST"] },
});

app.use(cors());

//mongodb database and collections:
const DB = "chat-bees";
const USER_COLLECTION = "users";
const USER_ROOM = "rooms";
const CHAT_COLLECTION = "chats";

//online users initialization:
let onlineUsers = {};

async function createMongoConnection() {
  const client = new MongoClient(MONGO_URL);

  await client.connect();
  // io.adapter(createAdapter(mongoCollection))
  console.log("Mongodb connected successfully !!");
  return client;
}

const client = await createMongoConnection();

app.get("/", (req, res) => {
  res.send("server is live");
});

//Hashing the password
async function getHashedPassword(password) {
  const NO_OF_ROUNDS = 10;
  const salt = await bcrypt.genSalt(NO_OF_ROUNDS);
  const hashedPassword = await bcrypt.hash(password, salt);
  return hashedPassword;
}

//checking if user already exists in database
async function checkUser(username) {
  return await client.db(DB).collection(USER_COLLECTION).findOne({ username });
}

//register a new user
app.post("/register", async (request, response) => {
  const { username, password } = request.body;
  const isUserExist = await checkUser(username);

  if (isUserExist) {
    response.status(201).send({ msg: "user already exists!!" });
    return;
  } else if (password.length < 8) {
    response
      .status(201)
      .send({ msg: "password must be more than or equal to 8 characters!!" });
    return;
  } else {
    const hashedPassword = await getHashedPassword(password);
    const result = await client.db(DB).collection(USER_COLLECTION).insertOne({
      username,
      password: hashedPassword,
    });

    result.acknowledged
      ? response.status(200).send({ msg: "Account created successfully!!" })
      : response.status(201).send({ msg: "Something went wrong !!" });
  }
});

//Returning all available users in database
async function allUsers(username) {
  return await client
    .db(DB)
    .collection(USER_COLLECTION)
    .find({})
    .toArray();
}

//endpoint to login an existing user
app.post("/login", async (request, response) => {
  const { username, password } = request.body;
  const isUserExist = await checkUser(username);

  if (isUserExist) {
    if (password.length < 8) {
      response
        .status(201)
        .send({ msg: "password must be more than or equal to 8 characters!!" });
      return;
    } else {
      const storedPassword = isUserExist.password;
      const isPasswordMatch = await bcrypt.compare(password, storedPassword);
      const allRegisteredUsers = await allUsers();

      if (isPasswordMatch) {
        response
          .status(200)
          .send({ msg: "login successful!!", users: allRegisteredUsers });
        return;
      } else {
        response.status(201).send({ msg: "Incorrect credentials!!" });
        return;
      }
    }
  } else {
    response.status(201).send({ msg: "User doesn't exist!!" });
  }
});

//getting the room-id if room exists for conversation, else create and return the id
app.post("/chatRoomId", async (req, res) => {
  const { users } = req.body;

  const room = await client
    .db(DB)
    .collection(USER_ROOM)
    .findOne({ users: { $all: users } });

  if (!room) {
    const roomId = uuidv4();
    await client.db(DB).collection(USER_ROOM).insertOne({ users, roomId });
    res.send(roomId);
    return;
  } else {
    res.status(200).send(room.roomId);
  }
});

//adding message in chat collection:
app.post("/addMessage", async (req, res) => {
  const data = req.body;

  try {
    await client.db(DB).collection(CHAT_COLLECTION).insertOne(data);
  } catch (error) {
    res.status(500).send(error);
  }
});

app.post("/roomConversations", async (req, res) => {
  const { roomId } = req.body;

  const conversations = (
    await client.db(DB).collection(CHAT_COLLECTION).find({ roomId }).toArray()
  ).sort();

  res.status(200).send(conversations);
});

io.on("connection", (socket) => {
  console.log(`user connected: ${socket.id}`);

  //user online status:
  socket.on("user-online", (username) => {
    onlineUsers[socket.id] = username;

    io.emit("user-status-online", onlineUsers);
  });

  socket.on("join-room", (roomId) => {
    //joining the desired room:
    socket.join(roomId);
  });

  //leaving the current room before joining next room:
  socket.on("leave-room", (roomId) => {
    socket.leave(roomId);
  });

  //sending messages from client side
  socket.on("sentMessage", async (data) => {
    socket.to(data.roomId).emit("receivedMessage", data);
  });

  //when user starts typing we emit typing started event
  socket.on("typing-started", (roomId) => {
    socket.to(roomId).emit("typing-status-started");
  });

  //when user starts typing we emit typing stopped event
  socket.on("typing-stopped", (roomId) => {
    socket.to(roomId).emit("typing-status-stopped");
  });

  //removing all the listeners when user disconnects
  socket.on("disconnect", () => {
    delete onlineUsers[socket.id];
    io.emit("user-status-online", onlineUsers);
    socket.removeAllListeners();
  });
});

server.listen(PORT, () => {
  console.log(`server is running on port ${PORT}`);
});
