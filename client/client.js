import { io } from "socket.io-client";

window.socket = io();

async function mainClient() {
    window.socket.on("connect", () => {
        console.log(window.socket.id);
    });
}
  
window.addEventListener("load", (event) => {
    mainClient();
    navigator.geolocation.getCurrentPosition((s) => {
        alert(s.coords.latitude);
    });
});