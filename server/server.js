const http = require("https");
const express = require("express");
const morgan = require("morgan");
const { Server } = require("socket.io");
const fs = require("fs");
let mongoose = require("mongoose");


const app = express();
app.use(morgan("combined"));
app.use(express.static("."));

app.use('/login', (req, res) => {
    res.send("this is login location");
});

const server = http.createServer({
    key: fs.readFileSync("../cert/key.pem"),
    cert: fs.readFileSync("../cert/cert.pem"), 
}, app);

const io = new Server(server);

io.on("connection", (socket) => {
    console.log(`Client connected with id: ${socket.id}`);
  
    socket.on("disconnect", () => {
        console.log(`Client disconnected with id: ${socket.id}`);
    });
});
  
server.listen(process.env.PORT || 5000, () => {
    console.log(`Server started on port ${server.address().port} :)`);
});