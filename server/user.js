let mongoose = require("mongoose");

let User = new mongoose.Schema({
    name: String,
    login: String,
    password: String,
    coordLng: Number,
    coordLat: Number,
    sessionId: Number,
    friends: [String],
    friendsReceivedReq: [String],
    friendsSentReq: [String],
    imageSrc: String,
    imageWidth: Number,
    imageHeight: Number,
    trackingGeo: Boolean,
    mapStyle: Number,
});

module.exports = mongoose.model('Users', User);