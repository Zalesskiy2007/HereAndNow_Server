import { io } from 'socket.io-client';

window.socket = io();

async function mainClient() {
    window.socket.on('connect', () => {
        console.log(window.socket.id);
    });
}

const imageToData = (image, func) => {
    let img = image;
    let canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d');

    canvas.width = img.width;
    canvas.height = img.height;

    img.crossOrigin = 'Anonymous';

    img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;
        func(data);
    };
};

const dataToImage = (data, width, height) => {
    let canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d');

    canvas.width = width;
    canvas.height = height;

    let imgData = new ImageData(data, width, height);
    ctx.putImageData(imgData, 0, 0);

    let url = canvas.toDataURL('image/jpeg');

    return url;
};

window.addEventListener('load', (event) => {
    mainClient();

    //Geo
    //SetInterval for watching

    /*navigator.geolocation.getCurrentPosition((s) => {
        alert(s.coords.latitude);
    });*/

    //Cookie for session storage

    /*$.cookie("test", "1");
    $.removeCookie("test");

    if ($.cookie("test"))
        alert($.cookie("test"));
    else
        alert("Hello"); */

    let x = document.getElementById('testimg');
    imageToData(x, (data) => {
        document.getElementById('imgres').src = dataToImage(
            data,
            x.width,
            x.height
        );
    });

    document.getElementById('file_btn').addEventListener('click', () => {
        let file = document.getElementById('file1');
        let f = file.files[0];

        if (f !== undefined) {
            let url = URL.createObjectURL(f);

            let newImg = document.createElement('img');
            newImg.src = url;

            newImg.onload = () => {
                newImg.width = 512; // need to do crop
                newImg.height = 512; // need to do crop
                // Now image is 512 * 512 pixels

                imageToData(newImg, (data) => {
                    let imgset = document.getElementById('imgset');
                    let newSrc = dataToImage(data, newImg.width, newImg.height); //String 17.9kB - 150 kB - save to DB
                    console.log(newSrc);
                    console.log(data);
                    document.getElementById('test').innerText =
                        newSrc.length / 1024.0 + ' KiloBytes';
                    imgset.src = newSrc;
                });
            };
        }
    });

    document.getElementById('btn').addEventListener('click', () => {
        window.location.href = '/login';
    });
});
