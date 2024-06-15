(function () {
    'use strict';

    const PACKET_TYPES = Object.create(null); // no Map = no polyfill
    PACKET_TYPES["open"] = "0";
    PACKET_TYPES["close"] = "1";
    PACKET_TYPES["ping"] = "2";
    PACKET_TYPES["pong"] = "3";
    PACKET_TYPES["message"] = "4";
    PACKET_TYPES["upgrade"] = "5";
    PACKET_TYPES["noop"] = "6";
    const PACKET_TYPES_REVERSE = Object.create(null);
    Object.keys(PACKET_TYPES).forEach((key) => {
        PACKET_TYPES_REVERSE[PACKET_TYPES[key]] = key;
    });
    const ERROR_PACKET = { type: "error", data: "parser error" };

    const withNativeBlob$1 = typeof Blob === "function" ||
        (typeof Blob !== "undefined" &&
            Object.prototype.toString.call(Blob) === "[object BlobConstructor]");
    const withNativeArrayBuffer$2 = typeof ArrayBuffer === "function";
    // ArrayBuffer.isView method is not defined in IE10
    const isView$1 = (obj) => {
        return typeof ArrayBuffer.isView === "function"
            ? ArrayBuffer.isView(obj)
            : obj && obj.buffer instanceof ArrayBuffer;
    };
    const encodePacket = ({ type, data }, supportsBinary, callback) => {
        if (withNativeBlob$1 && data instanceof Blob) {
            if (supportsBinary) {
                return callback(data);
            }
            else {
                return encodeBlobAsBase64(data, callback);
            }
        }
        else if (withNativeArrayBuffer$2 &&
            (data instanceof ArrayBuffer || isView$1(data))) {
            if (supportsBinary) {
                return callback(data);
            }
            else {
                return encodeBlobAsBase64(new Blob([data]), callback);
            }
        }
        // plain string
        return callback(PACKET_TYPES[type] + (data || ""));
    };
    const encodeBlobAsBase64 = (data, callback) => {
        const fileReader = new FileReader();
        fileReader.onload = function () {
            const content = fileReader.result.split(",")[1];
            callback("b" + (content || ""));
        };
        return fileReader.readAsDataURL(data);
    };
    function toArray(data) {
        if (data instanceof Uint8Array) {
            return data;
        }
        else if (data instanceof ArrayBuffer) {
            return new Uint8Array(data);
        }
        else {
            return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }
    }
    let TEXT_ENCODER;
    function encodePacketToBinary(packet, callback) {
        if (withNativeBlob$1 && packet.data instanceof Blob) {
            return packet.data.arrayBuffer().then(toArray).then(callback);
        }
        else if (withNativeArrayBuffer$2 &&
            (packet.data instanceof ArrayBuffer || isView$1(packet.data))) {
            return callback(toArray(packet.data));
        }
        encodePacket(packet, false, (encoded) => {
            if (!TEXT_ENCODER) {
                TEXT_ENCODER = new TextEncoder();
            }
            callback(TEXT_ENCODER.encode(encoded));
        });
    }

    // imported from https://github.com/socketio/base64-arraybuffer
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    // Use a lookup table to find the index.
    const lookup$1 = typeof Uint8Array === 'undefined' ? [] : new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) {
        lookup$1[chars.charCodeAt(i)] = i;
    }
    const decode$1 = (base64) => {
        let bufferLength = base64.length * 0.75, len = base64.length, i, p = 0, encoded1, encoded2, encoded3, encoded4;
        if (base64[base64.length - 1] === '=') {
            bufferLength--;
            if (base64[base64.length - 2] === '=') {
                bufferLength--;
            }
        }
        const arraybuffer = new ArrayBuffer(bufferLength), bytes = new Uint8Array(arraybuffer);
        for (i = 0; i < len; i += 4) {
            encoded1 = lookup$1[base64.charCodeAt(i)];
            encoded2 = lookup$1[base64.charCodeAt(i + 1)];
            encoded3 = lookup$1[base64.charCodeAt(i + 2)];
            encoded4 = lookup$1[base64.charCodeAt(i + 3)];
            bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
            bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
            bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
        }
        return arraybuffer;
    };

    const withNativeArrayBuffer$1 = typeof ArrayBuffer === "function";
    const decodePacket = (encodedPacket, binaryType) => {
        if (typeof encodedPacket !== "string") {
            return {
                type: "message",
                data: mapBinary(encodedPacket, binaryType),
            };
        }
        const type = encodedPacket.charAt(0);
        if (type === "b") {
            return {
                type: "message",
                data: decodeBase64Packet(encodedPacket.substring(1), binaryType),
            };
        }
        const packetType = PACKET_TYPES_REVERSE[type];
        if (!packetType) {
            return ERROR_PACKET;
        }
        return encodedPacket.length > 1
            ? {
                type: PACKET_TYPES_REVERSE[type],
                data: encodedPacket.substring(1),
            }
            : {
                type: PACKET_TYPES_REVERSE[type],
            };
    };
    const decodeBase64Packet = (data, binaryType) => {
        if (withNativeArrayBuffer$1) {
            const decoded = decode$1(data);
            return mapBinary(decoded, binaryType);
        }
        else {
            return { base64: true, data }; // fallback for old browsers
        }
    };
    const mapBinary = (data, binaryType) => {
        switch (binaryType) {
            case "blob":
                if (data instanceof Blob) {
                    // from WebSocket + binaryType "blob"
                    return data;
                }
                else {
                    // from HTTP long-polling or WebTransport
                    return new Blob([data]);
                }
            case "arraybuffer":
            default:
                if (data instanceof ArrayBuffer) {
                    // from HTTP long-polling (base64) or WebSocket + binaryType "arraybuffer"
                    return data;
                }
                else {
                    // from WebTransport (Uint8Array)
                    return data.buffer;
                }
        }
    };

    const SEPARATOR = String.fromCharCode(30); // see https://en.wikipedia.org/wiki/Delimiter#ASCII_delimited_text
    const encodePayload = (packets, callback) => {
        // some packets may be added to the array while encoding, so the initial length must be saved
        const length = packets.length;
        const encodedPackets = new Array(length);
        let count = 0;
        packets.forEach((packet, i) => {
            // force base64 encoding for binary packets
            encodePacket(packet, false, (encodedPacket) => {
                encodedPackets[i] = encodedPacket;
                if (++count === length) {
                    callback(encodedPackets.join(SEPARATOR));
                }
            });
        });
    };
    const decodePayload = (encodedPayload, binaryType) => {
        const encodedPackets = encodedPayload.split(SEPARATOR);
        const packets = [];
        for (let i = 0; i < encodedPackets.length; i++) {
            const decodedPacket = decodePacket(encodedPackets[i], binaryType);
            packets.push(decodedPacket);
            if (decodedPacket.type === "error") {
                break;
            }
        }
        return packets;
    };
    function createPacketEncoderStream() {
        // @ts-expect-error
        return new TransformStream({
            transform(packet, controller) {
                encodePacketToBinary(packet, (encodedPacket) => {
                    const payloadLength = encodedPacket.length;
                    let header;
                    // inspired by the WebSocket format: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers#decoding_payload_length
                    if (payloadLength < 126) {
                        header = new Uint8Array(1);
                        new DataView(header.buffer).setUint8(0, payloadLength);
                    }
                    else if (payloadLength < 65536) {
                        header = new Uint8Array(3);
                        const view = new DataView(header.buffer);
                        view.setUint8(0, 126);
                        view.setUint16(1, payloadLength);
                    }
                    else {
                        header = new Uint8Array(9);
                        const view = new DataView(header.buffer);
                        view.setUint8(0, 127);
                        view.setBigUint64(1, BigInt(payloadLength));
                    }
                    // first bit indicates whether the payload is plain text (0) or binary (1)
                    if (packet.data && typeof packet.data !== "string") {
                        header[0] |= 0x80;
                    }
                    controller.enqueue(header);
                    controller.enqueue(encodedPacket);
                });
            },
        });
    }
    let TEXT_DECODER;
    function totalLength(chunks) {
        return chunks.reduce((acc, chunk) => acc + chunk.length, 0);
    }
    function concatChunks(chunks, size) {
        if (chunks[0].length === size) {
            return chunks.shift();
        }
        const buffer = new Uint8Array(size);
        let j = 0;
        for (let i = 0; i < size; i++) {
            buffer[i] = chunks[0][j++];
            if (j === chunks[0].length) {
                chunks.shift();
                j = 0;
            }
        }
        if (chunks.length && j < chunks[0].length) {
            chunks[0] = chunks[0].slice(j);
        }
        return buffer;
    }
    function createPacketDecoderStream(maxPayload, binaryType) {
        if (!TEXT_DECODER) {
            TEXT_DECODER = new TextDecoder();
        }
        const chunks = [];
        let state = 0 /* READ_HEADER */;
        let expectedLength = -1;
        let isBinary = false;
        // @ts-expect-error
        return new TransformStream({
            transform(chunk, controller) {
                chunks.push(chunk);
                while (true) {
                    if (state === 0 /* READ_HEADER */) {
                        if (totalLength(chunks) < 1) {
                            break;
                        }
                        const header = concatChunks(chunks, 1);
                        isBinary = (header[0] & 0x80) === 0x80;
                        expectedLength = header[0] & 0x7f;
                        if (expectedLength < 126) {
                            state = 3 /* READ_PAYLOAD */;
                        }
                        else if (expectedLength === 126) {
                            state = 1 /* READ_EXTENDED_LENGTH_16 */;
                        }
                        else {
                            state = 2 /* READ_EXTENDED_LENGTH_64 */;
                        }
                    }
                    else if (state === 1 /* READ_EXTENDED_LENGTH_16 */) {
                        if (totalLength(chunks) < 2) {
                            break;
                        }
                        const headerArray = concatChunks(chunks, 2);
                        expectedLength = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length).getUint16(0);
                        state = 3 /* READ_PAYLOAD */;
                    }
                    else if (state === 2 /* READ_EXTENDED_LENGTH_64 */) {
                        if (totalLength(chunks) < 8) {
                            break;
                        }
                        const headerArray = concatChunks(chunks, 8);
                        const view = new DataView(headerArray.buffer, headerArray.byteOffset, headerArray.length);
                        const n = view.getUint32(0);
                        if (n > Math.pow(2, 53 - 32) - 1) {
                            // the maximum safe integer in JavaScript is 2^53 - 1
                            controller.enqueue(ERROR_PACKET);
                            break;
                        }
                        expectedLength = n * Math.pow(2, 32) + view.getUint32(4);
                        state = 3 /* READ_PAYLOAD */;
                    }
                    else {
                        if (totalLength(chunks) < expectedLength) {
                            break;
                        }
                        const data = concatChunks(chunks, expectedLength);
                        controller.enqueue(decodePacket(isBinary ? data : TEXT_DECODER.decode(data), binaryType));
                        state = 0 /* READ_HEADER */;
                    }
                    if (expectedLength === 0 || expectedLength > maxPayload) {
                        controller.enqueue(ERROR_PACKET);
                        break;
                    }
                }
            },
        });
    }
    const protocol$1 = 4;

    /**
     * Initialize a new `Emitter`.
     *
     * @api public
     */

    function Emitter(obj) {
      if (obj) return mixin(obj);
    }

    /**
     * Mixin the emitter properties.
     *
     * @param {Object} obj
     * @return {Object}
     * @api private
     */

    function mixin(obj) {
      for (var key in Emitter.prototype) {
        obj[key] = Emitter.prototype[key];
      }
      return obj;
    }

    /**
     * Listen on the given `event` with `fn`.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.on =
    Emitter.prototype.addEventListener = function(event, fn){
      this._callbacks = this._callbacks || {};
      (this._callbacks['$' + event] = this._callbacks['$' + event] || [])
        .push(fn);
      return this;
    };

    /**
     * Adds an `event` listener that will be invoked a single
     * time then automatically removed.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.once = function(event, fn){
      function on() {
        this.off(event, on);
        fn.apply(this, arguments);
      }

      on.fn = fn;
      this.on(event, on);
      return this;
    };

    /**
     * Remove the given callback for `event` or all
     * registered callbacks.
     *
     * @param {String} event
     * @param {Function} fn
     * @return {Emitter}
     * @api public
     */

    Emitter.prototype.off =
    Emitter.prototype.removeListener =
    Emitter.prototype.removeAllListeners =
    Emitter.prototype.removeEventListener = function(event, fn){
      this._callbacks = this._callbacks || {};

      // all
      if (0 == arguments.length) {
        this._callbacks = {};
        return this;
      }

      // specific event
      var callbacks = this._callbacks['$' + event];
      if (!callbacks) return this;

      // remove all handlers
      if (1 == arguments.length) {
        delete this._callbacks['$' + event];
        return this;
      }

      // remove specific handler
      var cb;
      for (var i = 0; i < callbacks.length; i++) {
        cb = callbacks[i];
        if (cb === fn || cb.fn === fn) {
          callbacks.splice(i, 1);
          break;
        }
      }

      // Remove event specific arrays for event types that no
      // one is subscribed for to avoid memory leak.
      if (callbacks.length === 0) {
        delete this._callbacks['$' + event];
      }

      return this;
    };

    /**
     * Emit `event` with the given args.
     *
     * @param {String} event
     * @param {Mixed} ...
     * @return {Emitter}
     */

    Emitter.prototype.emit = function(event){
      this._callbacks = this._callbacks || {};

      var args = new Array(arguments.length - 1)
        , callbacks = this._callbacks['$' + event];

      for (var i = 1; i < arguments.length; i++) {
        args[i - 1] = arguments[i];
      }

      if (callbacks) {
        callbacks = callbacks.slice(0);
        for (var i = 0, len = callbacks.length; i < len; ++i) {
          callbacks[i].apply(this, args);
        }
      }

      return this;
    };

    // alias used for reserved events (protected method)
    Emitter.prototype.emitReserved = Emitter.prototype.emit;

    /**
     * Return array of callbacks for `event`.
     *
     * @param {String} event
     * @return {Array}
     * @api public
     */

    Emitter.prototype.listeners = function(event){
      this._callbacks = this._callbacks || {};
      return this._callbacks['$' + event] || [];
    };

    /**
     * Check if this emitter has `event` handlers.
     *
     * @param {String} event
     * @return {Boolean}
     * @api public
     */

    Emitter.prototype.hasListeners = function(event){
      return !! this.listeners(event).length;
    };

    const globalThisShim = (() => {
        if (typeof self !== "undefined") {
            return self;
        }
        else if (typeof window !== "undefined") {
            return window;
        }
        else {
            return Function("return this")();
        }
    })();

    function pick(obj, ...attr) {
        return attr.reduce((acc, k) => {
            if (obj.hasOwnProperty(k)) {
                acc[k] = obj[k];
            }
            return acc;
        }, {});
    }
    // Keep a reference to the real timeout functions so they can be used when overridden
    const NATIVE_SET_TIMEOUT = globalThisShim.setTimeout;
    const NATIVE_CLEAR_TIMEOUT = globalThisShim.clearTimeout;
    function installTimerFunctions(obj, opts) {
        if (opts.useNativeTimers) {
            obj.setTimeoutFn = NATIVE_SET_TIMEOUT.bind(globalThisShim);
            obj.clearTimeoutFn = NATIVE_CLEAR_TIMEOUT.bind(globalThisShim);
        }
        else {
            obj.setTimeoutFn = globalThisShim.setTimeout.bind(globalThisShim);
            obj.clearTimeoutFn = globalThisShim.clearTimeout.bind(globalThisShim);
        }
    }
    // base64 encoded buffers are about 33% bigger (https://en.wikipedia.org/wiki/Base64)
    const BASE64_OVERHEAD = 1.33;
    // we could also have used `new Blob([obj]).size`, but it isn't supported in IE9
    function byteLength(obj) {
        if (typeof obj === "string") {
            return utf8Length(obj);
        }
        // arraybuffer or blob
        return Math.ceil((obj.byteLength || obj.size) * BASE64_OVERHEAD);
    }
    function utf8Length(str) {
        let c = 0, length = 0;
        for (let i = 0, l = str.length; i < l; i++) {
            c = str.charCodeAt(i);
            if (c < 0x80) {
                length += 1;
            }
            else if (c < 0x800) {
                length += 2;
            }
            else if (c < 0xd800 || c >= 0xe000) {
                length += 3;
            }
            else {
                i++;
                length += 4;
            }
        }
        return length;
    }

    // imported from https://github.com/galkn/querystring
    /**
     * Compiles a querystring
     * Returns string representation of the object
     *
     * @param {Object}
     * @api private
     */
    function encode$1(obj) {
        let str = '';
        for (let i in obj) {
            if (obj.hasOwnProperty(i)) {
                if (str.length)
                    str += '&';
                str += encodeURIComponent(i) + '=' + encodeURIComponent(obj[i]);
            }
        }
        return str;
    }
    /**
     * Parses a simple querystring into an object
     *
     * @param {String} qs
     * @api private
     */
    function decode(qs) {
        let qry = {};
        let pairs = qs.split('&');
        for (let i = 0, l = pairs.length; i < l; i++) {
            let pair = pairs[i].split('=');
            qry[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1]);
        }
        return qry;
    }

    class TransportError extends Error {
        constructor(reason, description, context) {
            super(reason);
            this.description = description;
            this.context = context;
            this.type = "TransportError";
        }
    }
    class Transport extends Emitter {
        /**
         * Transport abstract constructor.
         *
         * @param {Object} opts - options
         * @protected
         */
        constructor(opts) {
            super();
            this.writable = false;
            installTimerFunctions(this, opts);
            this.opts = opts;
            this.query = opts.query;
            this.socket = opts.socket;
        }
        /**
         * Emits an error.
         *
         * @param {String} reason
         * @param description
         * @param context - the error context
         * @return {Transport} for chaining
         * @protected
         */
        onError(reason, description, context) {
            super.emitReserved("error", new TransportError(reason, description, context));
            return this;
        }
        /**
         * Opens the transport.
         */
        open() {
            this.readyState = "opening";
            this.doOpen();
            return this;
        }
        /**
         * Closes the transport.
         */
        close() {
            if (this.readyState === "opening" || this.readyState === "open") {
                this.doClose();
                this.onClose();
            }
            return this;
        }
        /**
         * Sends multiple packets.
         *
         * @param {Array} packets
         */
        send(packets) {
            if (this.readyState === "open") {
                this.write(packets);
            }
        }
        /**
         * Called upon open
         *
         * @protected
         */
        onOpen() {
            this.readyState = "open";
            this.writable = true;
            super.emitReserved("open");
        }
        /**
         * Called with data.
         *
         * @param {String} data
         * @protected
         */
        onData(data) {
            const packet = decodePacket(data, this.socket.binaryType);
            this.onPacket(packet);
        }
        /**
         * Called with a decoded packet.
         *
         * @protected
         */
        onPacket(packet) {
            super.emitReserved("packet", packet);
        }
        /**
         * Called upon close.
         *
         * @protected
         */
        onClose(details) {
            this.readyState = "closed";
            super.emitReserved("close", details);
        }
        /**
         * Pauses the transport, in order not to lose packets during an upgrade.
         *
         * @param onPause
         */
        pause(onPause) { }
        createUri(schema, query = {}) {
            return (schema +
                "://" +
                this._hostname() +
                this._port() +
                this.opts.path +
                this._query(query));
        }
        _hostname() {
            const hostname = this.opts.hostname;
            return hostname.indexOf(":") === -1 ? hostname : "[" + hostname + "]";
        }
        _port() {
            if (this.opts.port &&
                ((this.opts.secure && Number(this.opts.port !== 443)) ||
                    (!this.opts.secure && Number(this.opts.port) !== 80))) {
                return ":" + this.opts.port;
            }
            else {
                return "";
            }
        }
        _query(query) {
            const encodedQuery = encode$1(query);
            return encodedQuery.length ? "?" + encodedQuery : "";
        }
    }

    // imported from https://github.com/unshiftio/yeast
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'.split(''), length = 64, map = {};
    let seed = 0, i = 0, prev;
    /**
     * Return a string representing the specified number.
     *
     * @param {Number} num The number to convert.
     * @returns {String} The string representation of the number.
     * @api public
     */
    function encode(num) {
        let encoded = '';
        do {
            encoded = alphabet[num % length] + encoded;
            num = Math.floor(num / length);
        } while (num > 0);
        return encoded;
    }
    /**
     * Yeast: A tiny growing id generator.
     *
     * @returns {String} A unique id.
     * @api public
     */
    function yeast() {
        const now = encode(+new Date());
        if (now !== prev)
            return seed = 0, prev = now;
        return now + '.' + encode(seed++);
    }
    //
    // Map each character to its index.
    //
    for (; i < length; i++)
        map[alphabet[i]] = i;

    // imported from https://github.com/component/has-cors
    let value = false;
    try {
        value = typeof XMLHttpRequest !== 'undefined' &&
            'withCredentials' in new XMLHttpRequest();
    }
    catch (err) {
        // if XMLHttp support is disabled in IE then it will throw
        // when trying to create
    }
    const hasCORS = value;

    // browser shim for xmlhttprequest module
    function XHR(opts) {
        const xdomain = opts.xdomain;
        // XMLHttpRequest can be disabled on IE
        try {
            if ("undefined" !== typeof XMLHttpRequest && (!xdomain || hasCORS)) {
                return new XMLHttpRequest();
            }
        }
        catch (e) { }
        if (!xdomain) {
            try {
                return new globalThisShim[["Active"].concat("Object").join("X")]("Microsoft.XMLHTTP");
            }
            catch (e) { }
        }
    }
    function createCookieJar() { }

    function empty() { }
    const hasXHR2 = (function () {
        const xhr = new XHR({
            xdomain: false,
        });
        return null != xhr.responseType;
    })();
    class Polling extends Transport {
        /**
         * XHR Polling constructor.
         *
         * @param {Object} opts
         * @package
         */
        constructor(opts) {
            super(opts);
            this.polling = false;
            if (typeof location !== "undefined") {
                const isSSL = "https:" === location.protocol;
                let port = location.port;
                // some user agents have empty `location.port`
                if (!port) {
                    port = isSSL ? "443" : "80";
                }
                this.xd =
                    (typeof location !== "undefined" &&
                        opts.hostname !== location.hostname) ||
                        port !== opts.port;
            }
            /**
             * XHR supports binary
             */
            const forceBase64 = opts && opts.forceBase64;
            this.supportsBinary = hasXHR2 && !forceBase64;
            if (this.opts.withCredentials) {
                this.cookieJar = createCookieJar();
            }
        }
        get name() {
            return "polling";
        }
        /**
         * Opens the socket (triggers polling). We write a PING message to determine
         * when the transport is open.
         *
         * @protected
         */
        doOpen() {
            this.poll();
        }
        /**
         * Pauses polling.
         *
         * @param {Function} onPause - callback upon buffers are flushed and transport is paused
         * @package
         */
        pause(onPause) {
            this.readyState = "pausing";
            const pause = () => {
                this.readyState = "paused";
                onPause();
            };
            if (this.polling || !this.writable) {
                let total = 0;
                if (this.polling) {
                    total++;
                    this.once("pollComplete", function () {
                        --total || pause();
                    });
                }
                if (!this.writable) {
                    total++;
                    this.once("drain", function () {
                        --total || pause();
                    });
                }
            }
            else {
                pause();
            }
        }
        /**
         * Starts polling cycle.
         *
         * @private
         */
        poll() {
            this.polling = true;
            this.doPoll();
            this.emitReserved("poll");
        }
        /**
         * Overloads onData to detect payloads.
         *
         * @protected
         */
        onData(data) {
            const callback = (packet) => {
                // if its the first message we consider the transport open
                if ("opening" === this.readyState && packet.type === "open") {
                    this.onOpen();
                }
                // if its a close packet, we close the ongoing requests
                if ("close" === packet.type) {
                    this.onClose({ description: "transport closed by the server" });
                    return false;
                }
                // otherwise bypass onData and handle the message
                this.onPacket(packet);
            };
            // decode payload
            decodePayload(data, this.socket.binaryType).forEach(callback);
            // if an event did not trigger closing
            if ("closed" !== this.readyState) {
                // if we got data we're not polling
                this.polling = false;
                this.emitReserved("pollComplete");
                if ("open" === this.readyState) {
                    this.poll();
                }
            }
        }
        /**
         * For polling, send a close packet.
         *
         * @protected
         */
        doClose() {
            const close = () => {
                this.write([{ type: "close" }]);
            };
            if ("open" === this.readyState) {
                close();
            }
            else {
                // in case we're trying to close while
                // handshaking is in progress (GH-164)
                this.once("open", close);
            }
        }
        /**
         * Writes a packets payload.
         *
         * @param {Array} packets - data packets
         * @protected
         */
        write(packets) {
            this.writable = false;
            encodePayload(packets, (data) => {
                this.doWrite(data, () => {
                    this.writable = true;
                    this.emitReserved("drain");
                });
            });
        }
        /**
         * Generates uri for connection.
         *
         * @private
         */
        uri() {
            const schema = this.opts.secure ? "https" : "http";
            const query = this.query || {};
            // cache busting is forced
            if (false !== this.opts.timestampRequests) {
                query[this.opts.timestampParam] = yeast();
            }
            if (!this.supportsBinary && !query.sid) {
                query.b64 = 1;
            }
            return this.createUri(schema, query);
        }
        /**
         * Creates a request.
         *
         * @param {String} method
         * @private
         */
        request(opts = {}) {
            Object.assign(opts, { xd: this.xd, cookieJar: this.cookieJar }, this.opts);
            return new Request(this.uri(), opts);
        }
        /**
         * Sends data.
         *
         * @param {String} data to send.
         * @param {Function} called upon flush.
         * @private
         */
        doWrite(data, fn) {
            const req = this.request({
                method: "POST",
                data: data,
            });
            req.on("success", fn);
            req.on("error", (xhrStatus, context) => {
                this.onError("xhr post error", xhrStatus, context);
            });
        }
        /**
         * Starts a poll cycle.
         *
         * @private
         */
        doPoll() {
            const req = this.request();
            req.on("data", this.onData.bind(this));
            req.on("error", (xhrStatus, context) => {
                this.onError("xhr poll error", xhrStatus, context);
            });
            this.pollXhr = req;
        }
    }
    class Request extends Emitter {
        /**
         * Request constructor
         *
         * @param {Object} options
         * @package
         */
        constructor(uri, opts) {
            super();
            installTimerFunctions(this, opts);
            this.opts = opts;
            this.method = opts.method || "GET";
            this.uri = uri;
            this.data = undefined !== opts.data ? opts.data : null;
            this.create();
        }
        /**
         * Creates the XHR object and sends the request.
         *
         * @private
         */
        create() {
            var _a;
            const opts = pick(this.opts, "agent", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "autoUnref");
            opts.xdomain = !!this.opts.xd;
            const xhr = (this.xhr = new XHR(opts));
            try {
                xhr.open(this.method, this.uri, true);
                try {
                    if (this.opts.extraHeaders) {
                        xhr.setDisableHeaderCheck && xhr.setDisableHeaderCheck(true);
                        for (let i in this.opts.extraHeaders) {
                            if (this.opts.extraHeaders.hasOwnProperty(i)) {
                                xhr.setRequestHeader(i, this.opts.extraHeaders[i]);
                            }
                        }
                    }
                }
                catch (e) { }
                if ("POST" === this.method) {
                    try {
                        xhr.setRequestHeader("Content-type", "text/plain;charset=UTF-8");
                    }
                    catch (e) { }
                }
                try {
                    xhr.setRequestHeader("Accept", "*/*");
                }
                catch (e) { }
                (_a = this.opts.cookieJar) === null || _a === void 0 ? void 0 : _a.addCookies(xhr);
                // ie6 check
                if ("withCredentials" in xhr) {
                    xhr.withCredentials = this.opts.withCredentials;
                }
                if (this.opts.requestTimeout) {
                    xhr.timeout = this.opts.requestTimeout;
                }
                xhr.onreadystatechange = () => {
                    var _a;
                    if (xhr.readyState === 3) {
                        (_a = this.opts.cookieJar) === null || _a === void 0 ? void 0 : _a.parseCookies(xhr);
                    }
                    if (4 !== xhr.readyState)
                        return;
                    if (200 === xhr.status || 1223 === xhr.status) {
                        this.onLoad();
                    }
                    else {
                        // make sure the `error` event handler that's user-set
                        // does not throw in the same tick and gets caught here
                        this.setTimeoutFn(() => {
                            this.onError(typeof xhr.status === "number" ? xhr.status : 0);
                        }, 0);
                    }
                };
                xhr.send(this.data);
            }
            catch (e) {
                // Need to defer since .create() is called directly from the constructor
                // and thus the 'error' event can only be only bound *after* this exception
                // occurs.  Therefore, also, we cannot throw here at all.
                this.setTimeoutFn(() => {
                    this.onError(e);
                }, 0);
                return;
            }
            if (typeof document !== "undefined") {
                this.index = Request.requestsCount++;
                Request.requests[this.index] = this;
            }
        }
        /**
         * Called upon error.
         *
         * @private
         */
        onError(err) {
            this.emitReserved("error", err, this.xhr);
            this.cleanup(true);
        }
        /**
         * Cleans up house.
         *
         * @private
         */
        cleanup(fromError) {
            if ("undefined" === typeof this.xhr || null === this.xhr) {
                return;
            }
            this.xhr.onreadystatechange = empty;
            if (fromError) {
                try {
                    this.xhr.abort();
                }
                catch (e) { }
            }
            if (typeof document !== "undefined") {
                delete Request.requests[this.index];
            }
            this.xhr = null;
        }
        /**
         * Called upon load.
         *
         * @private
         */
        onLoad() {
            const data = this.xhr.responseText;
            if (data !== null) {
                this.emitReserved("data", data);
                this.emitReserved("success");
                this.cleanup();
            }
        }
        /**
         * Aborts the request.
         *
         * @package
         */
        abort() {
            this.cleanup();
        }
    }
    Request.requestsCount = 0;
    Request.requests = {};
    /**
     * Aborts pending requests when unloading the window. This is needed to prevent
     * memory leaks (e.g. when using IE) and to ensure that no spurious error is
     * emitted.
     */
    if (typeof document !== "undefined") {
        // @ts-ignore
        if (typeof attachEvent === "function") {
            // @ts-ignore
            attachEvent("onunload", unloadHandler);
        }
        else if (typeof addEventListener === "function") {
            const terminationEvent = "onpagehide" in globalThisShim ? "pagehide" : "unload";
            addEventListener(terminationEvent, unloadHandler, false);
        }
    }
    function unloadHandler() {
        for (let i in Request.requests) {
            if (Request.requests.hasOwnProperty(i)) {
                Request.requests[i].abort();
            }
        }
    }

    const nextTick = (() => {
        const isPromiseAvailable = typeof Promise === "function" && typeof Promise.resolve === "function";
        if (isPromiseAvailable) {
            return (cb) => Promise.resolve().then(cb);
        }
        else {
            return (cb, setTimeoutFn) => setTimeoutFn(cb, 0);
        }
    })();
    const WebSocket = globalThisShim.WebSocket || globalThisShim.MozWebSocket;
    const usingBrowserWebSocket = true;
    const defaultBinaryType = "arraybuffer";

    // detect ReactNative environment
    const isReactNative = typeof navigator !== "undefined" &&
        typeof navigator.product === "string" &&
        navigator.product.toLowerCase() === "reactnative";
    class WS extends Transport {
        /**
         * WebSocket transport constructor.
         *
         * @param {Object} opts - connection options
         * @protected
         */
        constructor(opts) {
            super(opts);
            this.supportsBinary = !opts.forceBase64;
        }
        get name() {
            return "websocket";
        }
        doOpen() {
            if (!this.check()) {
                // let probe timeout
                return;
            }
            const uri = this.uri();
            const protocols = this.opts.protocols;
            // React Native only supports the 'headers' option, and will print a warning if anything else is passed
            const opts = isReactNative
                ? {}
                : pick(this.opts, "agent", "perMessageDeflate", "pfx", "key", "passphrase", "cert", "ca", "ciphers", "rejectUnauthorized", "localAddress", "protocolVersion", "origin", "maxPayload", "family", "checkServerIdentity");
            if (this.opts.extraHeaders) {
                opts.headers = this.opts.extraHeaders;
            }
            try {
                this.ws =
                    usingBrowserWebSocket && !isReactNative
                        ? protocols
                            ? new WebSocket(uri, protocols)
                            : new WebSocket(uri)
                        : new WebSocket(uri, protocols, opts);
            }
            catch (err) {
                return this.emitReserved("error", err);
            }
            this.ws.binaryType = this.socket.binaryType;
            this.addEventListeners();
        }
        /**
         * Adds event listeners to the socket
         *
         * @private
         */
        addEventListeners() {
            this.ws.onopen = () => {
                if (this.opts.autoUnref) {
                    this.ws._socket.unref();
                }
                this.onOpen();
            };
            this.ws.onclose = (closeEvent) => this.onClose({
                description: "websocket connection closed",
                context: closeEvent,
            });
            this.ws.onmessage = (ev) => this.onData(ev.data);
            this.ws.onerror = (e) => this.onError("websocket error", e);
        }
        write(packets) {
            this.writable = false;
            // encodePacket efficient as it uses WS framing
            // no need for encodePayload
            for (let i = 0; i < packets.length; i++) {
                const packet = packets[i];
                const lastPacket = i === packets.length - 1;
                encodePacket(packet, this.supportsBinary, (data) => {
                    // always create a new object (GH-437)
                    const opts = {};
                    // Sometimes the websocket has already been closed but the browser didn't
                    // have a chance of informing us about it yet, in that case send will
                    // throw an error
                    try {
                        if (usingBrowserWebSocket) {
                            // TypeError is thrown when passing the second argument on Safari
                            this.ws.send(data);
                        }
                    }
                    catch (e) {
                    }
                    if (lastPacket) {
                        // fake drain
                        // defer to next tick to allow Socket to clear writeBuffer
                        nextTick(() => {
                            this.writable = true;
                            this.emitReserved("drain");
                        }, this.setTimeoutFn);
                    }
                });
            }
        }
        doClose() {
            if (typeof this.ws !== "undefined") {
                this.ws.close();
                this.ws = null;
            }
        }
        /**
         * Generates uri for connection.
         *
         * @private
         */
        uri() {
            const schema = this.opts.secure ? "wss" : "ws";
            const query = this.query || {};
            // append timestamp to URI
            if (this.opts.timestampRequests) {
                query[this.opts.timestampParam] = yeast();
            }
            // communicate binary support capabilities
            if (!this.supportsBinary) {
                query.b64 = 1;
            }
            return this.createUri(schema, query);
        }
        /**
         * Feature detection for WebSocket.
         *
         * @return {Boolean} whether this transport is available.
         * @private
         */
        check() {
            return !!WebSocket;
        }
    }

    class WT extends Transport {
        get name() {
            return "webtransport";
        }
        doOpen() {
            // @ts-ignore
            if (typeof WebTransport !== "function") {
                return;
            }
            // @ts-ignore
            this.transport = new WebTransport(this.createUri("https"), this.opts.transportOptions[this.name]);
            this.transport.closed
                .then(() => {
                this.onClose();
            })
                .catch((err) => {
                this.onError("webtransport error", err);
            });
            // note: we could have used async/await, but that would require some additional polyfills
            this.transport.ready.then(() => {
                this.transport.createBidirectionalStream().then((stream) => {
                    const decoderStream = createPacketDecoderStream(Number.MAX_SAFE_INTEGER, this.socket.binaryType);
                    const reader = stream.readable.pipeThrough(decoderStream).getReader();
                    const encoderStream = createPacketEncoderStream();
                    encoderStream.readable.pipeTo(stream.writable);
                    this.writer = encoderStream.writable.getWriter();
                    const read = () => {
                        reader
                            .read()
                            .then(({ done, value }) => {
                            if (done) {
                                return;
                            }
                            this.onPacket(value);
                            read();
                        })
                            .catch((err) => {
                        });
                    };
                    read();
                    const packet = { type: "open" };
                    if (this.query.sid) {
                        packet.data = `{"sid":"${this.query.sid}"}`;
                    }
                    this.writer.write(packet).then(() => this.onOpen());
                });
            });
        }
        write(packets) {
            this.writable = false;
            for (let i = 0; i < packets.length; i++) {
                const packet = packets[i];
                const lastPacket = i === packets.length - 1;
                this.writer.write(packet).then(() => {
                    if (lastPacket) {
                        nextTick(() => {
                            this.writable = true;
                            this.emitReserved("drain");
                        }, this.setTimeoutFn);
                    }
                });
            }
        }
        doClose() {
            var _a;
            (_a = this.transport) === null || _a === void 0 ? void 0 : _a.close();
        }
    }

    const transports = {
        websocket: WS,
        webtransport: WT,
        polling: Polling,
    };

    // imported from https://github.com/galkn/parseuri
    /**
     * Parses a URI
     *
     * Note: we could also have used the built-in URL object, but it isn't supported on all platforms.
     *
     * See:
     * - https://developer.mozilla.org/en-US/docs/Web/API/URL
     * - https://caniuse.com/url
     * - https://www.rfc-editor.org/rfc/rfc3986#appendix-B
     *
     * History of the parse() method:
     * - first commit: https://github.com/socketio/socket.io-client/commit/4ee1d5d94b3906a9c052b459f1a818b15f38f91c
     * - export into its own module: https://github.com/socketio/engine.io-client/commit/de2c561e4564efeb78f1bdb1ba39ef81b2822cb3
     * - reimport: https://github.com/socketio/engine.io-client/commit/df32277c3f6d622eec5ed09f493cae3f3391d242
     *
     * @author Steven Levithan <stevenlevithan.com> (MIT license)
     * @api private
     */
    const re = /^(?:(?![^:@\/?#]+:[^:@\/]*@)(http|https|ws|wss):\/\/)?((?:(([^:@\/?#]*)(?::([^:@\/?#]*))?)?@)?((?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}|[^:\/?#]*)(?::(\d*))?)(((\/(?:[^?#](?![^?#\/]*\.[^?#\/.]+(?:[?#]|$)))*\/?)?([^?#\/]*))(?:\?([^#]*))?(?:#(.*))?)/;
    const parts = [
        'source', 'protocol', 'authority', 'userInfo', 'user', 'password', 'host', 'port', 'relative', 'path', 'directory', 'file', 'query', 'anchor'
    ];
    function parse(str) {
        if (str.length > 2000) {
            throw "URI too long";
        }
        const src = str, b = str.indexOf('['), e = str.indexOf(']');
        if (b != -1 && e != -1) {
            str = str.substring(0, b) + str.substring(b, e).replace(/:/g, ';') + str.substring(e, str.length);
        }
        let m = re.exec(str || ''), uri = {}, i = 14;
        while (i--) {
            uri[parts[i]] = m[i] || '';
        }
        if (b != -1 && e != -1) {
            uri.source = src;
            uri.host = uri.host.substring(1, uri.host.length - 1).replace(/;/g, ':');
            uri.authority = uri.authority.replace('[', '').replace(']', '').replace(/;/g, ':');
            uri.ipv6uri = true;
        }
        uri.pathNames = pathNames(uri, uri['path']);
        uri.queryKey = queryKey(uri, uri['query']);
        return uri;
    }
    function pathNames(obj, path) {
        const regx = /\/{2,9}/g, names = path.replace(regx, "/").split("/");
        if (path.slice(0, 1) == '/' || path.length === 0) {
            names.splice(0, 1);
        }
        if (path.slice(-1) == '/') {
            names.splice(names.length - 1, 1);
        }
        return names;
    }
    function queryKey(uri, query) {
        const data = {};
        query.replace(/(?:^|&)([^&=]*)=?([^&]*)/g, function ($0, $1, $2) {
            if ($1) {
                data[$1] = $2;
            }
        });
        return data;
    }

    let Socket$1 = class Socket extends Emitter {
        /**
         * Socket constructor.
         *
         * @param {String|Object} uri - uri or options
         * @param {Object} opts - options
         */
        constructor(uri, opts = {}) {
            super();
            this.binaryType = defaultBinaryType;
            this.writeBuffer = [];
            if (uri && "object" === typeof uri) {
                opts = uri;
                uri = null;
            }
            if (uri) {
                uri = parse(uri);
                opts.hostname = uri.host;
                opts.secure = uri.protocol === "https" || uri.protocol === "wss";
                opts.port = uri.port;
                if (uri.query)
                    opts.query = uri.query;
            }
            else if (opts.host) {
                opts.hostname = parse(opts.host).host;
            }
            installTimerFunctions(this, opts);
            this.secure =
                null != opts.secure
                    ? opts.secure
                    : typeof location !== "undefined" && "https:" === location.protocol;
            if (opts.hostname && !opts.port) {
                // if no port is specified manually, use the protocol default
                opts.port = this.secure ? "443" : "80";
            }
            this.hostname =
                opts.hostname ||
                    (typeof location !== "undefined" ? location.hostname : "localhost");
            this.port =
                opts.port ||
                    (typeof location !== "undefined" && location.port
                        ? location.port
                        : this.secure
                            ? "443"
                            : "80");
            this.transports = opts.transports || [
                "polling",
                "websocket",
                "webtransport",
            ];
            this.writeBuffer = [];
            this.prevBufferLen = 0;
            this.opts = Object.assign({
                path: "/engine.io",
                agent: false,
                withCredentials: false,
                upgrade: true,
                timestampParam: "t",
                rememberUpgrade: false,
                addTrailingSlash: true,
                rejectUnauthorized: true,
                perMessageDeflate: {
                    threshold: 1024,
                },
                transportOptions: {},
                closeOnBeforeunload: false,
            }, opts);
            this.opts.path =
                this.opts.path.replace(/\/$/, "") +
                    (this.opts.addTrailingSlash ? "/" : "");
            if (typeof this.opts.query === "string") {
                this.opts.query = decode(this.opts.query);
            }
            // set on handshake
            this.id = null;
            this.upgrades = null;
            this.pingInterval = null;
            this.pingTimeout = null;
            // set on heartbeat
            this.pingTimeoutTimer = null;
            if (typeof addEventListener === "function") {
                if (this.opts.closeOnBeforeunload) {
                    // Firefox closes the connection when the "beforeunload" event is emitted but not Chrome. This event listener
                    // ensures every browser behaves the same (no "disconnect" event at the Socket.IO level when the page is
                    // closed/reloaded)
                    this.beforeunloadEventListener = () => {
                        if (this.transport) {
                            // silently close the transport
                            this.transport.removeAllListeners();
                            this.transport.close();
                        }
                    };
                    addEventListener("beforeunload", this.beforeunloadEventListener, false);
                }
                if (this.hostname !== "localhost") {
                    this.offlineEventListener = () => {
                        this.onClose("transport close", {
                            description: "network connection lost",
                        });
                    };
                    addEventListener("offline", this.offlineEventListener, false);
                }
            }
            this.open();
        }
        /**
         * Creates transport of the given type.
         *
         * @param {String} name - transport name
         * @return {Transport}
         * @private
         */
        createTransport(name) {
            const query = Object.assign({}, this.opts.query);
            // append engine.io protocol identifier
            query.EIO = protocol$1;
            // transport name
            query.transport = name;
            // session id if we already have one
            if (this.id)
                query.sid = this.id;
            const opts = Object.assign({}, this.opts, {
                query,
                socket: this,
                hostname: this.hostname,
                secure: this.secure,
                port: this.port,
            }, this.opts.transportOptions[name]);
            return new transports[name](opts);
        }
        /**
         * Initializes transport to use and starts probe.
         *
         * @private
         */
        open() {
            let transport;
            if (this.opts.rememberUpgrade &&
                Socket.priorWebsocketSuccess &&
                this.transports.indexOf("websocket") !== -1) {
                transport = "websocket";
            }
            else if (0 === this.transports.length) {
                // Emit error on next tick so it can be listened to
                this.setTimeoutFn(() => {
                    this.emitReserved("error", "No transports available");
                }, 0);
                return;
            }
            else {
                transport = this.transports[0];
            }
            this.readyState = "opening";
            // Retry with the next transport if the transport is disabled (jsonp: false)
            try {
                transport = this.createTransport(transport);
            }
            catch (e) {
                this.transports.shift();
                this.open();
                return;
            }
            transport.open();
            this.setTransport(transport);
        }
        /**
         * Sets the current transport. Disables the existing one (if any).
         *
         * @private
         */
        setTransport(transport) {
            if (this.transport) {
                this.transport.removeAllListeners();
            }
            // set up transport
            this.transport = transport;
            // set up transport listeners
            transport
                .on("drain", this.onDrain.bind(this))
                .on("packet", this.onPacket.bind(this))
                .on("error", this.onError.bind(this))
                .on("close", (reason) => this.onClose("transport close", reason));
        }
        /**
         * Probes a transport.
         *
         * @param {String} name - transport name
         * @private
         */
        probe(name) {
            let transport = this.createTransport(name);
            let failed = false;
            Socket.priorWebsocketSuccess = false;
            const onTransportOpen = () => {
                if (failed)
                    return;
                transport.send([{ type: "ping", data: "probe" }]);
                transport.once("packet", (msg) => {
                    if (failed)
                        return;
                    if ("pong" === msg.type && "probe" === msg.data) {
                        this.upgrading = true;
                        this.emitReserved("upgrading", transport);
                        if (!transport)
                            return;
                        Socket.priorWebsocketSuccess = "websocket" === transport.name;
                        this.transport.pause(() => {
                            if (failed)
                                return;
                            if ("closed" === this.readyState)
                                return;
                            cleanup();
                            this.setTransport(transport);
                            transport.send([{ type: "upgrade" }]);
                            this.emitReserved("upgrade", transport);
                            transport = null;
                            this.upgrading = false;
                            this.flush();
                        });
                    }
                    else {
                        const err = new Error("probe error");
                        // @ts-ignore
                        err.transport = transport.name;
                        this.emitReserved("upgradeError", err);
                    }
                });
            };
            function freezeTransport() {
                if (failed)
                    return;
                // Any callback called by transport should be ignored since now
                failed = true;
                cleanup();
                transport.close();
                transport = null;
            }
            // Handle any error that happens while probing
            const onerror = (err) => {
                const error = new Error("probe error: " + err);
                // @ts-ignore
                error.transport = transport.name;
                freezeTransport();
                this.emitReserved("upgradeError", error);
            };
            function onTransportClose() {
                onerror("transport closed");
            }
            // When the socket is closed while we're probing
            function onclose() {
                onerror("socket closed");
            }
            // When the socket is upgraded while we're probing
            function onupgrade(to) {
                if (transport && to.name !== transport.name) {
                    freezeTransport();
                }
            }
            // Remove all listeners on the transport and on self
            const cleanup = () => {
                transport.removeListener("open", onTransportOpen);
                transport.removeListener("error", onerror);
                transport.removeListener("close", onTransportClose);
                this.off("close", onclose);
                this.off("upgrading", onupgrade);
            };
            transport.once("open", onTransportOpen);
            transport.once("error", onerror);
            transport.once("close", onTransportClose);
            this.once("close", onclose);
            this.once("upgrading", onupgrade);
            if (this.upgrades.indexOf("webtransport") !== -1 &&
                name !== "webtransport") {
                // favor WebTransport
                this.setTimeoutFn(() => {
                    if (!failed) {
                        transport.open();
                    }
                }, 200);
            }
            else {
                transport.open();
            }
        }
        /**
         * Called when connection is deemed open.
         *
         * @private
         */
        onOpen() {
            this.readyState = "open";
            Socket.priorWebsocketSuccess = "websocket" === this.transport.name;
            this.emitReserved("open");
            this.flush();
            // we check for `readyState` in case an `open`
            // listener already closed the socket
            if ("open" === this.readyState && this.opts.upgrade) {
                let i = 0;
                const l = this.upgrades.length;
                for (; i < l; i++) {
                    this.probe(this.upgrades[i]);
                }
            }
        }
        /**
         * Handles a packet.
         *
         * @private
         */
        onPacket(packet) {
            if ("opening" === this.readyState ||
                "open" === this.readyState ||
                "closing" === this.readyState) {
                this.emitReserved("packet", packet);
                // Socket is live - any packet counts
                this.emitReserved("heartbeat");
                this.resetPingTimeout();
                switch (packet.type) {
                    case "open":
                        this.onHandshake(JSON.parse(packet.data));
                        break;
                    case "ping":
                        this.sendPacket("pong");
                        this.emitReserved("ping");
                        this.emitReserved("pong");
                        break;
                    case "error":
                        const err = new Error("server error");
                        // @ts-ignore
                        err.code = packet.data;
                        this.onError(err);
                        break;
                    case "message":
                        this.emitReserved("data", packet.data);
                        this.emitReserved("message", packet.data);
                        break;
                }
            }
        }
        /**
         * Called upon handshake completion.
         *
         * @param {Object} data - handshake obj
         * @private
         */
        onHandshake(data) {
            this.emitReserved("handshake", data);
            this.id = data.sid;
            this.transport.query.sid = data.sid;
            this.upgrades = this.filterUpgrades(data.upgrades);
            this.pingInterval = data.pingInterval;
            this.pingTimeout = data.pingTimeout;
            this.maxPayload = data.maxPayload;
            this.onOpen();
            // In case open handler closes socket
            if ("closed" === this.readyState)
                return;
            this.resetPingTimeout();
        }
        /**
         * Sets and resets ping timeout timer based on server pings.
         *
         * @private
         */
        resetPingTimeout() {
            this.clearTimeoutFn(this.pingTimeoutTimer);
            this.pingTimeoutTimer = this.setTimeoutFn(() => {
                this.onClose("ping timeout");
            }, this.pingInterval + this.pingTimeout);
            if (this.opts.autoUnref) {
                this.pingTimeoutTimer.unref();
            }
        }
        /**
         * Called on `drain` event
         *
         * @private
         */
        onDrain() {
            this.writeBuffer.splice(0, this.prevBufferLen);
            // setting prevBufferLen = 0 is very important
            // for example, when upgrading, upgrade packet is sent over,
            // and a nonzero prevBufferLen could cause problems on `drain`
            this.prevBufferLen = 0;
            if (0 === this.writeBuffer.length) {
                this.emitReserved("drain");
            }
            else {
                this.flush();
            }
        }
        /**
         * Flush write buffers.
         *
         * @private
         */
        flush() {
            if ("closed" !== this.readyState &&
                this.transport.writable &&
                !this.upgrading &&
                this.writeBuffer.length) {
                const packets = this.getWritablePackets();
                this.transport.send(packets);
                // keep track of current length of writeBuffer
                // splice writeBuffer and callbackBuffer on `drain`
                this.prevBufferLen = packets.length;
                this.emitReserved("flush");
            }
        }
        /**
         * Ensure the encoded size of the writeBuffer is below the maxPayload value sent by the server (only for HTTP
         * long-polling)
         *
         * @private
         */
        getWritablePackets() {
            const shouldCheckPayloadSize = this.maxPayload &&
                this.transport.name === "polling" &&
                this.writeBuffer.length > 1;
            if (!shouldCheckPayloadSize) {
                return this.writeBuffer;
            }
            let payloadSize = 1; // first packet type
            for (let i = 0; i < this.writeBuffer.length; i++) {
                const data = this.writeBuffer[i].data;
                if (data) {
                    payloadSize += byteLength(data);
                }
                if (i > 0 && payloadSize > this.maxPayload) {
                    return this.writeBuffer.slice(0, i);
                }
                payloadSize += 2; // separator + packet type
            }
            return this.writeBuffer;
        }
        /**
         * Sends a message.
         *
         * @param {String} msg - message.
         * @param {Object} options.
         * @param {Function} callback function.
         * @return {Socket} for chaining.
         */
        write(msg, options, fn) {
            this.sendPacket("message", msg, options, fn);
            return this;
        }
        send(msg, options, fn) {
            this.sendPacket("message", msg, options, fn);
            return this;
        }
        /**
         * Sends a packet.
         *
         * @param {String} type: packet type.
         * @param {String} data.
         * @param {Object} options.
         * @param {Function} fn - callback function.
         * @private
         */
        sendPacket(type, data, options, fn) {
            if ("function" === typeof data) {
                fn = data;
                data = undefined;
            }
            if ("function" === typeof options) {
                fn = options;
                options = null;
            }
            if ("closing" === this.readyState || "closed" === this.readyState) {
                return;
            }
            options = options || {};
            options.compress = false !== options.compress;
            const packet = {
                type: type,
                data: data,
                options: options,
            };
            this.emitReserved("packetCreate", packet);
            this.writeBuffer.push(packet);
            if (fn)
                this.once("flush", fn);
            this.flush();
        }
        /**
         * Closes the connection.
         */
        close() {
            const close = () => {
                this.onClose("forced close");
                this.transport.close();
            };
            const cleanupAndClose = () => {
                this.off("upgrade", cleanupAndClose);
                this.off("upgradeError", cleanupAndClose);
                close();
            };
            const waitForUpgrade = () => {
                // wait for upgrade to finish since we can't send packets while pausing a transport
                this.once("upgrade", cleanupAndClose);
                this.once("upgradeError", cleanupAndClose);
            };
            if ("opening" === this.readyState || "open" === this.readyState) {
                this.readyState = "closing";
                if (this.writeBuffer.length) {
                    this.once("drain", () => {
                        if (this.upgrading) {
                            waitForUpgrade();
                        }
                        else {
                            close();
                        }
                    });
                }
                else if (this.upgrading) {
                    waitForUpgrade();
                }
                else {
                    close();
                }
            }
            return this;
        }
        /**
         * Called upon transport error
         *
         * @private
         */
        onError(err) {
            Socket.priorWebsocketSuccess = false;
            this.emitReserved("error", err);
            this.onClose("transport error", err);
        }
        /**
         * Called upon transport close.
         *
         * @private
         */
        onClose(reason, description) {
            if ("opening" === this.readyState ||
                "open" === this.readyState ||
                "closing" === this.readyState) {
                // clear timers
                this.clearTimeoutFn(this.pingTimeoutTimer);
                // stop event from firing again for transport
                this.transport.removeAllListeners("close");
                // ensure transport won't stay open
                this.transport.close();
                // ignore further transport communication
                this.transport.removeAllListeners();
                if (typeof removeEventListener === "function") {
                    removeEventListener("beforeunload", this.beforeunloadEventListener, false);
                    removeEventListener("offline", this.offlineEventListener, false);
                }
                // set ready state
                this.readyState = "closed";
                // clear session id
                this.id = null;
                // emit close event
                this.emitReserved("close", reason, description);
                // clean buffers after, so users can still
                // grab the buffers on `close` event
                this.writeBuffer = [];
                this.prevBufferLen = 0;
            }
        }
        /**
         * Filters upgrades, returning only those matching client transports.
         *
         * @param {Array} upgrades - server upgrades
         * @private
         */
        filterUpgrades(upgrades) {
            const filteredUpgrades = [];
            let i = 0;
            const j = upgrades.length;
            for (; i < j; i++) {
                if (~this.transports.indexOf(upgrades[i]))
                    filteredUpgrades.push(upgrades[i]);
            }
            return filteredUpgrades;
        }
    };
    Socket$1.protocol = protocol$1;

    /**
     * URL parser.
     *
     * @param uri - url
     * @param path - the request path of the connection
     * @param loc - An object meant to mimic window.location.
     *        Defaults to window.location.
     * @public
     */
    function url(uri, path = "", loc) {
        let obj = uri;
        // default to window.location
        loc = loc || (typeof location !== "undefined" && location);
        if (null == uri)
            uri = loc.protocol + "//" + loc.host;
        // relative path support
        if (typeof uri === "string") {
            if ("/" === uri.charAt(0)) {
                if ("/" === uri.charAt(1)) {
                    uri = loc.protocol + uri;
                }
                else {
                    uri = loc.host + uri;
                }
            }
            if (!/^(https?|wss?):\/\//.test(uri)) {
                if ("undefined" !== typeof loc) {
                    uri = loc.protocol + "//" + uri;
                }
                else {
                    uri = "https://" + uri;
                }
            }
            // parse
            obj = parse(uri);
        }
        // make sure we treat `localhost:80` and `localhost` equally
        if (!obj.port) {
            if (/^(http|ws)$/.test(obj.protocol)) {
                obj.port = "80";
            }
            else if (/^(http|ws)s$/.test(obj.protocol)) {
                obj.port = "443";
            }
        }
        obj.path = obj.path || "/";
        const ipv6 = obj.host.indexOf(":") !== -1;
        const host = ipv6 ? "[" + obj.host + "]" : obj.host;
        // define unique id
        obj.id = obj.protocol + "://" + host + ":" + obj.port + path;
        // define href
        obj.href =
            obj.protocol +
                "://" +
                host +
                (loc && loc.port === obj.port ? "" : ":" + obj.port);
        return obj;
    }

    const withNativeArrayBuffer = typeof ArrayBuffer === "function";
    const isView = (obj) => {
        return typeof ArrayBuffer.isView === "function"
            ? ArrayBuffer.isView(obj)
            : obj.buffer instanceof ArrayBuffer;
    };
    const toString = Object.prototype.toString;
    const withNativeBlob = typeof Blob === "function" ||
        (typeof Blob !== "undefined" &&
            toString.call(Blob) === "[object BlobConstructor]");
    const withNativeFile = typeof File === "function" ||
        (typeof File !== "undefined" &&
            toString.call(File) === "[object FileConstructor]");
    /**
     * Returns true if obj is a Buffer, an ArrayBuffer, a Blob or a File.
     *
     * @private
     */
    function isBinary(obj) {
        return ((withNativeArrayBuffer && (obj instanceof ArrayBuffer || isView(obj))) ||
            (withNativeBlob && obj instanceof Blob) ||
            (withNativeFile && obj instanceof File));
    }
    function hasBinary(obj, toJSON) {
        if (!obj || typeof obj !== "object") {
            return false;
        }
        if (Array.isArray(obj)) {
            for (let i = 0, l = obj.length; i < l; i++) {
                if (hasBinary(obj[i])) {
                    return true;
                }
            }
            return false;
        }
        if (isBinary(obj)) {
            return true;
        }
        if (obj.toJSON &&
            typeof obj.toJSON === "function" &&
            arguments.length === 1) {
            return hasBinary(obj.toJSON(), true);
        }
        for (const key in obj) {
            if (Object.prototype.hasOwnProperty.call(obj, key) && hasBinary(obj[key])) {
                return true;
            }
        }
        return false;
    }

    /**
     * Replaces every Buffer | ArrayBuffer | Blob | File in packet with a numbered placeholder.
     *
     * @param {Object} packet - socket.io event packet
     * @return {Object} with deconstructed packet and list of buffers
     * @public
     */
    function deconstructPacket(packet) {
        const buffers = [];
        const packetData = packet.data;
        const pack = packet;
        pack.data = _deconstructPacket(packetData, buffers);
        pack.attachments = buffers.length; // number of binary 'attachments'
        return { packet: pack, buffers: buffers };
    }
    function _deconstructPacket(data, buffers) {
        if (!data)
            return data;
        if (isBinary(data)) {
            const placeholder = { _placeholder: true, num: buffers.length };
            buffers.push(data);
            return placeholder;
        }
        else if (Array.isArray(data)) {
            const newData = new Array(data.length);
            for (let i = 0; i < data.length; i++) {
                newData[i] = _deconstructPacket(data[i], buffers);
            }
            return newData;
        }
        else if (typeof data === "object" && !(data instanceof Date)) {
            const newData = {};
            for (const key in data) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    newData[key] = _deconstructPacket(data[key], buffers);
                }
            }
            return newData;
        }
        return data;
    }
    /**
     * Reconstructs a binary packet from its placeholder packet and buffers
     *
     * @param {Object} packet - event packet with placeholders
     * @param {Array} buffers - binary buffers to put in placeholder positions
     * @return {Object} reconstructed packet
     * @public
     */
    function reconstructPacket(packet, buffers) {
        packet.data = _reconstructPacket(packet.data, buffers);
        delete packet.attachments; // no longer useful
        return packet;
    }
    function _reconstructPacket(data, buffers) {
        if (!data)
            return data;
        if (data && data._placeholder === true) {
            const isIndexValid = typeof data.num === "number" &&
                data.num >= 0 &&
                data.num < buffers.length;
            if (isIndexValid) {
                return buffers[data.num]; // appropriate buffer (should be natural order anyway)
            }
            else {
                throw new Error("illegal attachments");
            }
        }
        else if (Array.isArray(data)) {
            for (let i = 0; i < data.length; i++) {
                data[i] = _reconstructPacket(data[i], buffers);
            }
        }
        else if (typeof data === "object") {
            for (const key in data) {
                if (Object.prototype.hasOwnProperty.call(data, key)) {
                    data[key] = _reconstructPacket(data[key], buffers);
                }
            }
        }
        return data;
    }

    /**
     * These strings must not be used as event names, as they have a special meaning.
     */
    const RESERVED_EVENTS$1 = [
        "connect",
        "connect_error",
        "disconnect",
        "disconnecting",
        "newListener",
        "removeListener", // used by the Node.js EventEmitter
    ];
    /**
     * Protocol version.
     *
     * @public
     */
    const protocol = 5;
    var PacketType;
    (function (PacketType) {
        PacketType[PacketType["CONNECT"] = 0] = "CONNECT";
        PacketType[PacketType["DISCONNECT"] = 1] = "DISCONNECT";
        PacketType[PacketType["EVENT"] = 2] = "EVENT";
        PacketType[PacketType["ACK"] = 3] = "ACK";
        PacketType[PacketType["CONNECT_ERROR"] = 4] = "CONNECT_ERROR";
        PacketType[PacketType["BINARY_EVENT"] = 5] = "BINARY_EVENT";
        PacketType[PacketType["BINARY_ACK"] = 6] = "BINARY_ACK";
    })(PacketType || (PacketType = {}));
    /**
     * A socket.io Encoder instance
     */
    class Encoder {
        /**
         * Encoder constructor
         *
         * @param {function} replacer - custom replacer to pass down to JSON.parse
         */
        constructor(replacer) {
            this.replacer = replacer;
        }
        /**
         * Encode a packet as a single string if non-binary, or as a
         * buffer sequence, depending on packet type.
         *
         * @param {Object} obj - packet object
         */
        encode(obj) {
            if (obj.type === PacketType.EVENT || obj.type === PacketType.ACK) {
                if (hasBinary(obj)) {
                    return this.encodeAsBinary({
                        type: obj.type === PacketType.EVENT
                            ? PacketType.BINARY_EVENT
                            : PacketType.BINARY_ACK,
                        nsp: obj.nsp,
                        data: obj.data,
                        id: obj.id,
                    });
                }
            }
            return [this.encodeAsString(obj)];
        }
        /**
         * Encode packet as string.
         */
        encodeAsString(obj) {
            // first is type
            let str = "" + obj.type;
            // attachments if we have them
            if (obj.type === PacketType.BINARY_EVENT ||
                obj.type === PacketType.BINARY_ACK) {
                str += obj.attachments + "-";
            }
            // if we have a namespace other than `/`
            // we append it followed by a comma `,`
            if (obj.nsp && "/" !== obj.nsp) {
                str += obj.nsp + ",";
            }
            // immediately followed by the id
            if (null != obj.id) {
                str += obj.id;
            }
            // json data
            if (null != obj.data) {
                str += JSON.stringify(obj.data, this.replacer);
            }
            return str;
        }
        /**
         * Encode packet as 'buffer sequence' by removing blobs, and
         * deconstructing packet into object with placeholders and
         * a list of buffers.
         */
        encodeAsBinary(obj) {
            const deconstruction = deconstructPacket(obj);
            const pack = this.encodeAsString(deconstruction.packet);
            const buffers = deconstruction.buffers;
            buffers.unshift(pack); // add packet info to beginning of data list
            return buffers; // write all the buffers
        }
    }
    // see https://stackoverflow.com/questions/8511281/check-if-a-value-is-an-object-in-javascript
    function isObject(value) {
        return Object.prototype.toString.call(value) === "[object Object]";
    }
    /**
     * A socket.io Decoder instance
     *
     * @return {Object} decoder
     */
    class Decoder extends Emitter {
        /**
         * Decoder constructor
         *
         * @param {function} reviver - custom reviver to pass down to JSON.stringify
         */
        constructor(reviver) {
            super();
            this.reviver = reviver;
        }
        /**
         * Decodes an encoded packet string into packet JSON.
         *
         * @param {String} obj - encoded packet
         */
        add(obj) {
            let packet;
            if (typeof obj === "string") {
                if (this.reconstructor) {
                    throw new Error("got plaintext data when reconstructing a packet");
                }
                packet = this.decodeString(obj);
                const isBinaryEvent = packet.type === PacketType.BINARY_EVENT;
                if (isBinaryEvent || packet.type === PacketType.BINARY_ACK) {
                    packet.type = isBinaryEvent ? PacketType.EVENT : PacketType.ACK;
                    // binary packet's json
                    this.reconstructor = new BinaryReconstructor(packet);
                    // no attachments, labeled binary but no binary data to follow
                    if (packet.attachments === 0) {
                        super.emitReserved("decoded", packet);
                    }
                }
                else {
                    // non-binary full packet
                    super.emitReserved("decoded", packet);
                }
            }
            else if (isBinary(obj) || obj.base64) {
                // raw binary data
                if (!this.reconstructor) {
                    throw new Error("got binary data when not reconstructing a packet");
                }
                else {
                    packet = this.reconstructor.takeBinaryData(obj);
                    if (packet) {
                        // received final buffer
                        this.reconstructor = null;
                        super.emitReserved("decoded", packet);
                    }
                }
            }
            else {
                throw new Error("Unknown type: " + obj);
            }
        }
        /**
         * Decode a packet String (JSON data)
         *
         * @param {String} str
         * @return {Object} packet
         */
        decodeString(str) {
            let i = 0;
            // look up type
            const p = {
                type: Number(str.charAt(0)),
            };
            if (PacketType[p.type] === undefined) {
                throw new Error("unknown packet type " + p.type);
            }
            // look up attachments if type binary
            if (p.type === PacketType.BINARY_EVENT ||
                p.type === PacketType.BINARY_ACK) {
                const start = i + 1;
                while (str.charAt(++i) !== "-" && i != str.length) { }
                const buf = str.substring(start, i);
                if (buf != Number(buf) || str.charAt(i) !== "-") {
                    throw new Error("Illegal attachments");
                }
                p.attachments = Number(buf);
            }
            // look up namespace (if any)
            if ("/" === str.charAt(i + 1)) {
                const start = i + 1;
                while (++i) {
                    const c = str.charAt(i);
                    if ("," === c)
                        break;
                    if (i === str.length)
                        break;
                }
                p.nsp = str.substring(start, i);
            }
            else {
                p.nsp = "/";
            }
            // look up id
            const next = str.charAt(i + 1);
            if ("" !== next && Number(next) == next) {
                const start = i + 1;
                while (++i) {
                    const c = str.charAt(i);
                    if (null == c || Number(c) != c) {
                        --i;
                        break;
                    }
                    if (i === str.length)
                        break;
                }
                p.id = Number(str.substring(start, i + 1));
            }
            // look up json data
            if (str.charAt(++i)) {
                const payload = this.tryParse(str.substr(i));
                if (Decoder.isPayloadValid(p.type, payload)) {
                    p.data = payload;
                }
                else {
                    throw new Error("invalid payload");
                }
            }
            return p;
        }
        tryParse(str) {
            try {
                return JSON.parse(str, this.reviver);
            }
            catch (e) {
                return false;
            }
        }
        static isPayloadValid(type, payload) {
            switch (type) {
                case PacketType.CONNECT:
                    return isObject(payload);
                case PacketType.DISCONNECT:
                    return payload === undefined;
                case PacketType.CONNECT_ERROR:
                    return typeof payload === "string" || isObject(payload);
                case PacketType.EVENT:
                case PacketType.BINARY_EVENT:
                    return (Array.isArray(payload) &&
                        (typeof payload[0] === "number" ||
                            (typeof payload[0] === "string" &&
                                RESERVED_EVENTS$1.indexOf(payload[0]) === -1)));
                case PacketType.ACK:
                case PacketType.BINARY_ACK:
                    return Array.isArray(payload);
            }
        }
        /**
         * Deallocates a parser's resources
         */
        destroy() {
            if (this.reconstructor) {
                this.reconstructor.finishedReconstruction();
                this.reconstructor = null;
            }
        }
    }
    /**
     * A manager of a binary event's 'buffer sequence'. Should
     * be constructed whenever a packet of type BINARY_EVENT is
     * decoded.
     *
     * @param {Object} packet
     * @return {BinaryReconstructor} initialized reconstructor
     */
    class BinaryReconstructor {
        constructor(packet) {
            this.packet = packet;
            this.buffers = [];
            this.reconPack = packet;
        }
        /**
         * Method to be called when binary data received from connection
         * after a BINARY_EVENT packet.
         *
         * @param {Buffer | ArrayBuffer} binData - the raw binary data received
         * @return {null | Object} returns null if more binary data is expected or
         *   a reconstructed packet object if all buffers have been received.
         */
        takeBinaryData(binData) {
            this.buffers.push(binData);
            if (this.buffers.length === this.reconPack.attachments) {
                // done with buffer list
                const packet = reconstructPacket(this.reconPack, this.buffers);
                this.finishedReconstruction();
                return packet;
            }
            return null;
        }
        /**
         * Cleans up binary packet reconstruction variables.
         */
        finishedReconstruction() {
            this.reconPack = null;
            this.buffers = [];
        }
    }

    var parser = /*#__PURE__*/Object.freeze({
        __proto__: null,
        Decoder: Decoder,
        Encoder: Encoder,
        get PacketType () { return PacketType; },
        protocol: protocol
    });

    function on(obj, ev, fn) {
        obj.on(ev, fn);
        return function subDestroy() {
            obj.off(ev, fn);
        };
    }

    /**
     * Internal events.
     * These events can't be emitted by the user.
     */
    const RESERVED_EVENTS = Object.freeze({
        connect: 1,
        connect_error: 1,
        disconnect: 1,
        disconnecting: 1,
        // EventEmitter reserved events: https://nodejs.org/api/events.html#events_event_newlistener
        newListener: 1,
        removeListener: 1,
    });
    /**
     * A Socket is the fundamental class for interacting with the server.
     *
     * A Socket belongs to a certain Namespace (by default /) and uses an underlying {@link Manager} to communicate.
     *
     * @example
     * const socket = io();
     *
     * socket.on("connect", () => {
     *   console.log("connected");
     * });
     *
     * // send an event to the server
     * socket.emit("foo", "bar");
     *
     * socket.on("foobar", () => {
     *   // an event was received from the server
     * });
     *
     * // upon disconnection
     * socket.on("disconnect", (reason) => {
     *   console.log(`disconnected due to ${reason}`);
     * });
     */
    class Socket extends Emitter {
        /**
         * `Socket` constructor.
         */
        constructor(io, nsp, opts) {
            super();
            /**
             * Whether the socket is currently connected to the server.
             *
             * @example
             * const socket = io();
             *
             * socket.on("connect", () => {
             *   console.log(socket.connected); // true
             * });
             *
             * socket.on("disconnect", () => {
             *   console.log(socket.connected); // false
             * });
             */
            this.connected = false;
            /**
             * Whether the connection state was recovered after a temporary disconnection. In that case, any missed packets will
             * be transmitted by the server.
             */
            this.recovered = false;
            /**
             * Buffer for packets received before the CONNECT packet
             */
            this.receiveBuffer = [];
            /**
             * Buffer for packets that will be sent once the socket is connected
             */
            this.sendBuffer = [];
            /**
             * The queue of packets to be sent with retry in case of failure.
             *
             * Packets are sent one by one, each waiting for the server acknowledgement, in order to guarantee the delivery order.
             * @private
             */
            this._queue = [];
            /**
             * A sequence to generate the ID of the {@link QueuedPacket}.
             * @private
             */
            this._queueSeq = 0;
            this.ids = 0;
            /**
             * A map containing acknowledgement handlers.
             *
             * The `withError` attribute is used to differentiate handlers that accept an error as first argument:
             *
             * - `socket.emit("test", (err, value) => { ... })` with `ackTimeout` option
             * - `socket.timeout(5000).emit("test", (err, value) => { ... })`
             * - `const value = await socket.emitWithAck("test")`
             *
             * From those that don't:
             *
             * - `socket.emit("test", (value) => { ... });`
             *
             * In the first case, the handlers will be called with an error when:
             *
             * - the timeout is reached
             * - the socket gets disconnected
             *
             * In the second case, the handlers will be simply discarded upon disconnection, since the client will never receive
             * an acknowledgement from the server.
             *
             * @private
             */
            this.acks = {};
            this.flags = {};
            this.io = io;
            this.nsp = nsp;
            if (opts && opts.auth) {
                this.auth = opts.auth;
            }
            this._opts = Object.assign({}, opts);
            if (this.io._autoConnect)
                this.open();
        }
        /**
         * Whether the socket is currently disconnected
         *
         * @example
         * const socket = io();
         *
         * socket.on("connect", () => {
         *   console.log(socket.disconnected); // false
         * });
         *
         * socket.on("disconnect", () => {
         *   console.log(socket.disconnected); // true
         * });
         */
        get disconnected() {
            return !this.connected;
        }
        /**
         * Subscribe to open, close and packet events
         *
         * @private
         */
        subEvents() {
            if (this.subs)
                return;
            const io = this.io;
            this.subs = [
                on(io, "open", this.onopen.bind(this)),
                on(io, "packet", this.onpacket.bind(this)),
                on(io, "error", this.onerror.bind(this)),
                on(io, "close", this.onclose.bind(this)),
            ];
        }
        /**
         * Whether the Socket will try to reconnect when its Manager connects or reconnects.
         *
         * @example
         * const socket = io();
         *
         * console.log(socket.active); // true
         *
         * socket.on("disconnect", (reason) => {
         *   if (reason === "io server disconnect") {
         *     // the disconnection was initiated by the server, you need to manually reconnect
         *     console.log(socket.active); // false
         *   }
         *   // else the socket will automatically try to reconnect
         *   console.log(socket.active); // true
         * });
         */
        get active() {
            return !!this.subs;
        }
        /**
         * "Opens" the socket.
         *
         * @example
         * const socket = io({
         *   autoConnect: false
         * });
         *
         * socket.connect();
         */
        connect() {
            if (this.connected)
                return this;
            this.subEvents();
            if (!this.io["_reconnecting"])
                this.io.open(); // ensure open
            if ("open" === this.io._readyState)
                this.onopen();
            return this;
        }
        /**
         * Alias for {@link connect()}.
         */
        open() {
            return this.connect();
        }
        /**
         * Sends a `message` event.
         *
         * This method mimics the WebSocket.send() method.
         *
         * @see https://developer.mozilla.org/en-US/docs/Web/API/WebSocket/send
         *
         * @example
         * socket.send("hello");
         *
         * // this is equivalent to
         * socket.emit("message", "hello");
         *
         * @return self
         */
        send(...args) {
            args.unshift("message");
            this.emit.apply(this, args);
            return this;
        }
        /**
         * Override `emit`.
         * If the event is in `events`, it's emitted normally.
         *
         * @example
         * socket.emit("hello", "world");
         *
         * // all serializable datastructures are supported (no need to call JSON.stringify)
         * socket.emit("hello", 1, "2", { 3: ["4"], 5: Uint8Array.from([6]) });
         *
         * // with an acknowledgement from the server
         * socket.emit("hello", "world", (val) => {
         *   // ...
         * });
         *
         * @return self
         */
        emit(ev, ...args) {
            if (RESERVED_EVENTS.hasOwnProperty(ev)) {
                throw new Error('"' + ev.toString() + '" is a reserved event name');
            }
            args.unshift(ev);
            if (this._opts.retries && !this.flags.fromQueue && !this.flags.volatile) {
                this._addToQueue(args);
                return this;
            }
            const packet = {
                type: PacketType.EVENT,
                data: args,
            };
            packet.options = {};
            packet.options.compress = this.flags.compress !== false;
            // event ack callback
            if ("function" === typeof args[args.length - 1]) {
                const id = this.ids++;
                const ack = args.pop();
                this._registerAckCallback(id, ack);
                packet.id = id;
            }
            const isTransportWritable = this.io.engine &&
                this.io.engine.transport &&
                this.io.engine.transport.writable;
            const discardPacket = this.flags.volatile && (!isTransportWritable || !this.connected);
            if (discardPacket) ;
            else if (this.connected) {
                this.notifyOutgoingListeners(packet);
                this.packet(packet);
            }
            else {
                this.sendBuffer.push(packet);
            }
            this.flags = {};
            return this;
        }
        /**
         * @private
         */
        _registerAckCallback(id, ack) {
            var _a;
            const timeout = (_a = this.flags.timeout) !== null && _a !== void 0 ? _a : this._opts.ackTimeout;
            if (timeout === undefined) {
                this.acks[id] = ack;
                return;
            }
            // @ts-ignore
            const timer = this.io.setTimeoutFn(() => {
                delete this.acks[id];
                for (let i = 0; i < this.sendBuffer.length; i++) {
                    if (this.sendBuffer[i].id === id) {
                        this.sendBuffer.splice(i, 1);
                    }
                }
                ack.call(this, new Error("operation has timed out"));
            }, timeout);
            const fn = (...args) => {
                // @ts-ignore
                this.io.clearTimeoutFn(timer);
                ack.apply(this, args);
            };
            fn.withError = true;
            this.acks[id] = fn;
        }
        /**
         * Emits an event and waits for an acknowledgement
         *
         * @example
         * // without timeout
         * const response = await socket.emitWithAck("hello", "world");
         *
         * // with a specific timeout
         * try {
         *   const response = await socket.timeout(1000).emitWithAck("hello", "world");
         * } catch (err) {
         *   // the server did not acknowledge the event in the given delay
         * }
         *
         * @return a Promise that will be fulfilled when the server acknowledges the event
         */
        emitWithAck(ev, ...args) {
            return new Promise((resolve, reject) => {
                const fn = (arg1, arg2) => {
                    return arg1 ? reject(arg1) : resolve(arg2);
                };
                fn.withError = true;
                args.push(fn);
                this.emit(ev, ...args);
            });
        }
        /**
         * Add the packet to the queue.
         * @param args
         * @private
         */
        _addToQueue(args) {
            let ack;
            if (typeof args[args.length - 1] === "function") {
                ack = args.pop();
            }
            const packet = {
                id: this._queueSeq++,
                tryCount: 0,
                pending: false,
                args,
                flags: Object.assign({ fromQueue: true }, this.flags),
            };
            args.push((err, ...responseArgs) => {
                if (packet !== this._queue[0]) {
                    // the packet has already been acknowledged
                    return;
                }
                const hasError = err !== null;
                if (hasError) {
                    if (packet.tryCount > this._opts.retries) {
                        this._queue.shift();
                        if (ack) {
                            ack(err);
                        }
                    }
                }
                else {
                    this._queue.shift();
                    if (ack) {
                        ack(null, ...responseArgs);
                    }
                }
                packet.pending = false;
                return this._drainQueue();
            });
            this._queue.push(packet);
            this._drainQueue();
        }
        /**
         * Send the first packet of the queue, and wait for an acknowledgement from the server.
         * @param force - whether to resend a packet that has not been acknowledged yet
         *
         * @private
         */
        _drainQueue(force = false) {
            if (!this.connected || this._queue.length === 0) {
                return;
            }
            const packet = this._queue[0];
            if (packet.pending && !force) {
                return;
            }
            packet.pending = true;
            packet.tryCount++;
            this.flags = packet.flags;
            this.emit.apply(this, packet.args);
        }
        /**
         * Sends a packet.
         *
         * @param packet
         * @private
         */
        packet(packet) {
            packet.nsp = this.nsp;
            this.io._packet(packet);
        }
        /**
         * Called upon engine `open`.
         *
         * @private
         */
        onopen() {
            if (typeof this.auth == "function") {
                this.auth((data) => {
                    this._sendConnectPacket(data);
                });
            }
            else {
                this._sendConnectPacket(this.auth);
            }
        }
        /**
         * Sends a CONNECT packet to initiate the Socket.IO session.
         *
         * @param data
         * @private
         */
        _sendConnectPacket(data) {
            this.packet({
                type: PacketType.CONNECT,
                data: this._pid
                    ? Object.assign({ pid: this._pid, offset: this._lastOffset }, data)
                    : data,
            });
        }
        /**
         * Called upon engine or manager `error`.
         *
         * @param err
         * @private
         */
        onerror(err) {
            if (!this.connected) {
                this.emitReserved("connect_error", err);
            }
        }
        /**
         * Called upon engine `close`.
         *
         * @param reason
         * @param description
         * @private
         */
        onclose(reason, description) {
            this.connected = false;
            delete this.id;
            this.emitReserved("disconnect", reason, description);
            this._clearAcks();
        }
        /**
         * Clears the acknowledgement handlers upon disconnection, since the client will never receive an acknowledgement from
         * the server.
         *
         * @private
         */
        _clearAcks() {
            Object.keys(this.acks).forEach((id) => {
                const isBuffered = this.sendBuffer.some((packet) => String(packet.id) === id);
                if (!isBuffered) {
                    // note: handlers that do not accept an error as first argument are ignored here
                    const ack = this.acks[id];
                    delete this.acks[id];
                    if (ack.withError) {
                        ack.call(this, new Error("socket has been disconnected"));
                    }
                }
            });
        }
        /**
         * Called with socket packet.
         *
         * @param packet
         * @private
         */
        onpacket(packet) {
            const sameNamespace = packet.nsp === this.nsp;
            if (!sameNamespace)
                return;
            switch (packet.type) {
                case PacketType.CONNECT:
                    if (packet.data && packet.data.sid) {
                        this.onconnect(packet.data.sid, packet.data.pid);
                    }
                    else {
                        this.emitReserved("connect_error", new Error("It seems you are trying to reach a Socket.IO server in v2.x with a v3.x client, but they are not compatible (more information here: https://socket.io/docs/v3/migrating-from-2-x-to-3-0/)"));
                    }
                    break;
                case PacketType.EVENT:
                case PacketType.BINARY_EVENT:
                    this.onevent(packet);
                    break;
                case PacketType.ACK:
                case PacketType.BINARY_ACK:
                    this.onack(packet);
                    break;
                case PacketType.DISCONNECT:
                    this.ondisconnect();
                    break;
                case PacketType.CONNECT_ERROR:
                    this.destroy();
                    const err = new Error(packet.data.message);
                    // @ts-ignore
                    err.data = packet.data.data;
                    this.emitReserved("connect_error", err);
                    break;
            }
        }
        /**
         * Called upon a server event.
         *
         * @param packet
         * @private
         */
        onevent(packet) {
            const args = packet.data || [];
            if (null != packet.id) {
                args.push(this.ack(packet.id));
            }
            if (this.connected) {
                this.emitEvent(args);
            }
            else {
                this.receiveBuffer.push(Object.freeze(args));
            }
        }
        emitEvent(args) {
            if (this._anyListeners && this._anyListeners.length) {
                const listeners = this._anyListeners.slice();
                for (const listener of listeners) {
                    listener.apply(this, args);
                }
            }
            super.emit.apply(this, args);
            if (this._pid && args.length && typeof args[args.length - 1] === "string") {
                this._lastOffset = args[args.length - 1];
            }
        }
        /**
         * Produces an ack callback to emit with an event.
         *
         * @private
         */
        ack(id) {
            const self = this;
            let sent = false;
            return function (...args) {
                // prevent double callbacks
                if (sent)
                    return;
                sent = true;
                self.packet({
                    type: PacketType.ACK,
                    id: id,
                    data: args,
                });
            };
        }
        /**
         * Called upon a server acknowledgement.
         *
         * @param packet
         * @private
         */
        onack(packet) {
            const ack = this.acks[packet.id];
            if (typeof ack !== "function") {
                return;
            }
            delete this.acks[packet.id];
            // @ts-ignore FIXME ack is incorrectly inferred as 'never'
            if (ack.withError) {
                packet.data.unshift(null);
            }
            // @ts-ignore
            ack.apply(this, packet.data);
        }
        /**
         * Called upon server connect.
         *
         * @private
         */
        onconnect(id, pid) {
            this.id = id;
            this.recovered = pid && this._pid === pid;
            this._pid = pid; // defined only if connection state recovery is enabled
            this.connected = true;
            this.emitBuffered();
            this.emitReserved("connect");
            this._drainQueue(true);
        }
        /**
         * Emit buffered events (received and emitted).
         *
         * @private
         */
        emitBuffered() {
            this.receiveBuffer.forEach((args) => this.emitEvent(args));
            this.receiveBuffer = [];
            this.sendBuffer.forEach((packet) => {
                this.notifyOutgoingListeners(packet);
                this.packet(packet);
            });
            this.sendBuffer = [];
        }
        /**
         * Called upon server disconnect.
         *
         * @private
         */
        ondisconnect() {
            this.destroy();
            this.onclose("io server disconnect");
        }
        /**
         * Called upon forced client/server side disconnections,
         * this method ensures the manager stops tracking us and
         * that reconnections don't get triggered for this.
         *
         * @private
         */
        destroy() {
            if (this.subs) {
                // clean subscriptions to avoid reconnections
                this.subs.forEach((subDestroy) => subDestroy());
                this.subs = undefined;
            }
            this.io["_destroy"](this);
        }
        /**
         * Disconnects the socket manually. In that case, the socket will not try to reconnect.
         *
         * If this is the last active Socket instance of the {@link Manager}, the low-level connection will be closed.
         *
         * @example
         * const socket = io();
         *
         * socket.on("disconnect", (reason) => {
         *   // console.log(reason); prints "io client disconnect"
         * });
         *
         * socket.disconnect();
         *
         * @return self
         */
        disconnect() {
            if (this.connected) {
                this.packet({ type: PacketType.DISCONNECT });
            }
            // remove socket from pool
            this.destroy();
            if (this.connected) {
                // fire events
                this.onclose("io client disconnect");
            }
            return this;
        }
        /**
         * Alias for {@link disconnect()}.
         *
         * @return self
         */
        close() {
            return this.disconnect();
        }
        /**
         * Sets the compress flag.
         *
         * @example
         * socket.compress(false).emit("hello");
         *
         * @param compress - if `true`, compresses the sending data
         * @return self
         */
        compress(compress) {
            this.flags.compress = compress;
            return this;
        }
        /**
         * Sets a modifier for a subsequent event emission that the event message will be dropped when this socket is not
         * ready to send messages.
         *
         * @example
         * socket.volatile.emit("hello"); // the server may or may not receive it
         *
         * @returns self
         */
        get volatile() {
            this.flags.volatile = true;
            return this;
        }
        /**
         * Sets a modifier for a subsequent event emission that the callback will be called with an error when the
         * given number of milliseconds have elapsed without an acknowledgement from the server:
         *
         * @example
         * socket.timeout(5000).emit("my-event", (err) => {
         *   if (err) {
         *     // the server did not acknowledge the event in the given delay
         *   }
         * });
         *
         * @returns self
         */
        timeout(timeout) {
            this.flags.timeout = timeout;
            return this;
        }
        /**
         * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
         * callback.
         *
         * @example
         * socket.onAny((event, ...args) => {
         *   console.log(`got ${event}`);
         * });
         *
         * @param listener
         */
        onAny(listener) {
            this._anyListeners = this._anyListeners || [];
            this._anyListeners.push(listener);
            return this;
        }
        /**
         * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
         * callback. The listener is added to the beginning of the listeners array.
         *
         * @example
         * socket.prependAny((event, ...args) => {
         *   console.log(`got event ${event}`);
         * });
         *
         * @param listener
         */
        prependAny(listener) {
            this._anyListeners = this._anyListeners || [];
            this._anyListeners.unshift(listener);
            return this;
        }
        /**
         * Removes the listener that will be fired when any event is emitted.
         *
         * @example
         * const catchAllListener = (event, ...args) => {
         *   console.log(`got event ${event}`);
         * }
         *
         * socket.onAny(catchAllListener);
         *
         * // remove a specific listener
         * socket.offAny(catchAllListener);
         *
         * // or remove all listeners
         * socket.offAny();
         *
         * @param listener
         */
        offAny(listener) {
            if (!this._anyListeners) {
                return this;
            }
            if (listener) {
                const listeners = this._anyListeners;
                for (let i = 0; i < listeners.length; i++) {
                    if (listener === listeners[i]) {
                        listeners.splice(i, 1);
                        return this;
                    }
                }
            }
            else {
                this._anyListeners = [];
            }
            return this;
        }
        /**
         * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
         * e.g. to remove listeners.
         */
        listenersAny() {
            return this._anyListeners || [];
        }
        /**
         * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
         * callback.
         *
         * Note: acknowledgements sent to the server are not included.
         *
         * @example
         * socket.onAnyOutgoing((event, ...args) => {
         *   console.log(`sent event ${event}`);
         * });
         *
         * @param listener
         */
        onAnyOutgoing(listener) {
            this._anyOutgoingListeners = this._anyOutgoingListeners || [];
            this._anyOutgoingListeners.push(listener);
            return this;
        }
        /**
         * Adds a listener that will be fired when any event is emitted. The event name is passed as the first argument to the
         * callback. The listener is added to the beginning of the listeners array.
         *
         * Note: acknowledgements sent to the server are not included.
         *
         * @example
         * socket.prependAnyOutgoing((event, ...args) => {
         *   console.log(`sent event ${event}`);
         * });
         *
         * @param listener
         */
        prependAnyOutgoing(listener) {
            this._anyOutgoingListeners = this._anyOutgoingListeners || [];
            this._anyOutgoingListeners.unshift(listener);
            return this;
        }
        /**
         * Removes the listener that will be fired when any event is emitted.
         *
         * @example
         * const catchAllListener = (event, ...args) => {
         *   console.log(`sent event ${event}`);
         * }
         *
         * socket.onAnyOutgoing(catchAllListener);
         *
         * // remove a specific listener
         * socket.offAnyOutgoing(catchAllListener);
         *
         * // or remove all listeners
         * socket.offAnyOutgoing();
         *
         * @param [listener] - the catch-all listener (optional)
         */
        offAnyOutgoing(listener) {
            if (!this._anyOutgoingListeners) {
                return this;
            }
            if (listener) {
                const listeners = this._anyOutgoingListeners;
                for (let i = 0; i < listeners.length; i++) {
                    if (listener === listeners[i]) {
                        listeners.splice(i, 1);
                        return this;
                    }
                }
            }
            else {
                this._anyOutgoingListeners = [];
            }
            return this;
        }
        /**
         * Returns an array of listeners that are listening for any event that is specified. This array can be manipulated,
         * e.g. to remove listeners.
         */
        listenersAnyOutgoing() {
            return this._anyOutgoingListeners || [];
        }
        /**
         * Notify the listeners for each packet sent
         *
         * @param packet
         *
         * @private
         */
        notifyOutgoingListeners(packet) {
            if (this._anyOutgoingListeners && this._anyOutgoingListeners.length) {
                const listeners = this._anyOutgoingListeners.slice();
                for (const listener of listeners) {
                    listener.apply(this, packet.data);
                }
            }
        }
    }

    /**
     * Initialize backoff timer with `opts`.
     *
     * - `min` initial timeout in milliseconds [100]
     * - `max` max timeout [10000]
     * - `jitter` [0]
     * - `factor` [2]
     *
     * @param {Object} opts
     * @api public
     */
    function Backoff(opts) {
        opts = opts || {};
        this.ms = opts.min || 100;
        this.max = opts.max || 10000;
        this.factor = opts.factor || 2;
        this.jitter = opts.jitter > 0 && opts.jitter <= 1 ? opts.jitter : 0;
        this.attempts = 0;
    }
    /**
     * Return the backoff duration.
     *
     * @return {Number}
     * @api public
     */
    Backoff.prototype.duration = function () {
        var ms = this.ms * Math.pow(this.factor, this.attempts++);
        if (this.jitter) {
            var rand = Math.random();
            var deviation = Math.floor(rand * this.jitter * ms);
            ms = (Math.floor(rand * 10) & 1) == 0 ? ms - deviation : ms + deviation;
        }
        return Math.min(ms, this.max) | 0;
    };
    /**
     * Reset the number of attempts.
     *
     * @api public
     */
    Backoff.prototype.reset = function () {
        this.attempts = 0;
    };
    /**
     * Set the minimum duration
     *
     * @api public
     */
    Backoff.prototype.setMin = function (min) {
        this.ms = min;
    };
    /**
     * Set the maximum duration
     *
     * @api public
     */
    Backoff.prototype.setMax = function (max) {
        this.max = max;
    };
    /**
     * Set the jitter
     *
     * @api public
     */
    Backoff.prototype.setJitter = function (jitter) {
        this.jitter = jitter;
    };

    class Manager extends Emitter {
        constructor(uri, opts) {
            var _a;
            super();
            this.nsps = {};
            this.subs = [];
            if (uri && "object" === typeof uri) {
                opts = uri;
                uri = undefined;
            }
            opts = opts || {};
            opts.path = opts.path || "/socket.io";
            this.opts = opts;
            installTimerFunctions(this, opts);
            this.reconnection(opts.reconnection !== false);
            this.reconnectionAttempts(opts.reconnectionAttempts || Infinity);
            this.reconnectionDelay(opts.reconnectionDelay || 1000);
            this.reconnectionDelayMax(opts.reconnectionDelayMax || 5000);
            this.randomizationFactor((_a = opts.randomizationFactor) !== null && _a !== void 0 ? _a : 0.5);
            this.backoff = new Backoff({
                min: this.reconnectionDelay(),
                max: this.reconnectionDelayMax(),
                jitter: this.randomizationFactor(),
            });
            this.timeout(null == opts.timeout ? 20000 : opts.timeout);
            this._readyState = "closed";
            this.uri = uri;
            const _parser = opts.parser || parser;
            this.encoder = new _parser.Encoder();
            this.decoder = new _parser.Decoder();
            this._autoConnect = opts.autoConnect !== false;
            if (this._autoConnect)
                this.open();
        }
        reconnection(v) {
            if (!arguments.length)
                return this._reconnection;
            this._reconnection = !!v;
            return this;
        }
        reconnectionAttempts(v) {
            if (v === undefined)
                return this._reconnectionAttempts;
            this._reconnectionAttempts = v;
            return this;
        }
        reconnectionDelay(v) {
            var _a;
            if (v === undefined)
                return this._reconnectionDelay;
            this._reconnectionDelay = v;
            (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMin(v);
            return this;
        }
        randomizationFactor(v) {
            var _a;
            if (v === undefined)
                return this._randomizationFactor;
            this._randomizationFactor = v;
            (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setJitter(v);
            return this;
        }
        reconnectionDelayMax(v) {
            var _a;
            if (v === undefined)
                return this._reconnectionDelayMax;
            this._reconnectionDelayMax = v;
            (_a = this.backoff) === null || _a === void 0 ? void 0 : _a.setMax(v);
            return this;
        }
        timeout(v) {
            if (!arguments.length)
                return this._timeout;
            this._timeout = v;
            return this;
        }
        /**
         * Starts trying to reconnect if reconnection is enabled and we have not
         * started reconnecting yet
         *
         * @private
         */
        maybeReconnectOnOpen() {
            // Only try to reconnect if it's the first time we're connecting
            if (!this._reconnecting &&
                this._reconnection &&
                this.backoff.attempts === 0) {
                // keeps reconnection from firing twice for the same reconnection loop
                this.reconnect();
            }
        }
        /**
         * Sets the current transport `socket`.
         *
         * @param {Function} fn - optional, callback
         * @return self
         * @public
         */
        open(fn) {
            if (~this._readyState.indexOf("open"))
                return this;
            this.engine = new Socket$1(this.uri, this.opts);
            const socket = this.engine;
            const self = this;
            this._readyState = "opening";
            this.skipReconnect = false;
            // emit `open`
            const openSubDestroy = on(socket, "open", function () {
                self.onopen();
                fn && fn();
            });
            const onError = (err) => {
                this.cleanup();
                this._readyState = "closed";
                this.emitReserved("error", err);
                if (fn) {
                    fn(err);
                }
                else {
                    // Only do this if there is no fn to handle the error
                    this.maybeReconnectOnOpen();
                }
            };
            // emit `error`
            const errorSub = on(socket, "error", onError);
            if (false !== this._timeout) {
                const timeout = this._timeout;
                // set timer
                const timer = this.setTimeoutFn(() => {
                    openSubDestroy();
                    onError(new Error("timeout"));
                    socket.close();
                }, timeout);
                if (this.opts.autoUnref) {
                    timer.unref();
                }
                this.subs.push(() => {
                    this.clearTimeoutFn(timer);
                });
            }
            this.subs.push(openSubDestroy);
            this.subs.push(errorSub);
            return this;
        }
        /**
         * Alias for open()
         *
         * @return self
         * @public
         */
        connect(fn) {
            return this.open(fn);
        }
        /**
         * Called upon transport open.
         *
         * @private
         */
        onopen() {
            // clear old subs
            this.cleanup();
            // mark as open
            this._readyState = "open";
            this.emitReserved("open");
            // add new subs
            const socket = this.engine;
            this.subs.push(on(socket, "ping", this.onping.bind(this)), on(socket, "data", this.ondata.bind(this)), on(socket, "error", this.onerror.bind(this)), on(socket, "close", this.onclose.bind(this)), on(this.decoder, "decoded", this.ondecoded.bind(this)));
        }
        /**
         * Called upon a ping.
         *
         * @private
         */
        onping() {
            this.emitReserved("ping");
        }
        /**
         * Called with data.
         *
         * @private
         */
        ondata(data) {
            try {
                this.decoder.add(data);
            }
            catch (e) {
                this.onclose("parse error", e);
            }
        }
        /**
         * Called when parser fully decodes a packet.
         *
         * @private
         */
        ondecoded(packet) {
            // the nextTick call prevents an exception in a user-provided event listener from triggering a disconnection due to a "parse error"
            nextTick(() => {
                this.emitReserved("packet", packet);
            }, this.setTimeoutFn);
        }
        /**
         * Called upon socket error.
         *
         * @private
         */
        onerror(err) {
            this.emitReserved("error", err);
        }
        /**
         * Creates a new socket for the given `nsp`.
         *
         * @return {Socket}
         * @public
         */
        socket(nsp, opts) {
            let socket = this.nsps[nsp];
            if (!socket) {
                socket = new Socket(this, nsp, opts);
                this.nsps[nsp] = socket;
            }
            else if (this._autoConnect && !socket.active) {
                socket.connect();
            }
            return socket;
        }
        /**
         * Called upon a socket close.
         *
         * @param socket
         * @private
         */
        _destroy(socket) {
            const nsps = Object.keys(this.nsps);
            for (const nsp of nsps) {
                const socket = this.nsps[nsp];
                if (socket.active) {
                    return;
                }
            }
            this._close();
        }
        /**
         * Writes a packet.
         *
         * @param packet
         * @private
         */
        _packet(packet) {
            const encodedPackets = this.encoder.encode(packet);
            for (let i = 0; i < encodedPackets.length; i++) {
                this.engine.write(encodedPackets[i], packet.options);
            }
        }
        /**
         * Clean up transport subscriptions and packet buffer.
         *
         * @private
         */
        cleanup() {
            this.subs.forEach((subDestroy) => subDestroy());
            this.subs.length = 0;
            this.decoder.destroy();
        }
        /**
         * Close the current socket.
         *
         * @private
         */
        _close() {
            this.skipReconnect = true;
            this._reconnecting = false;
            this.onclose("forced close");
            if (this.engine)
                this.engine.close();
        }
        /**
         * Alias for close()
         *
         * @private
         */
        disconnect() {
            return this._close();
        }
        /**
         * Called upon engine close.
         *
         * @private
         */
        onclose(reason, description) {
            this.cleanup();
            this.backoff.reset();
            this._readyState = "closed";
            this.emitReserved("close", reason, description);
            if (this._reconnection && !this.skipReconnect) {
                this.reconnect();
            }
        }
        /**
         * Attempt a reconnection.
         *
         * @private
         */
        reconnect() {
            if (this._reconnecting || this.skipReconnect)
                return this;
            const self = this;
            if (this.backoff.attempts >= this._reconnectionAttempts) {
                this.backoff.reset();
                this.emitReserved("reconnect_failed");
                this._reconnecting = false;
            }
            else {
                const delay = this.backoff.duration();
                this._reconnecting = true;
                const timer = this.setTimeoutFn(() => {
                    if (self.skipReconnect)
                        return;
                    this.emitReserved("reconnect_attempt", self.backoff.attempts);
                    // check again for the case socket closed in above events
                    if (self.skipReconnect)
                        return;
                    self.open((err) => {
                        if (err) {
                            self._reconnecting = false;
                            self.reconnect();
                            this.emitReserved("reconnect_error", err);
                        }
                        else {
                            self.onreconnect();
                        }
                    });
                }, delay);
                if (this.opts.autoUnref) {
                    timer.unref();
                }
                this.subs.push(() => {
                    this.clearTimeoutFn(timer);
                });
            }
        }
        /**
         * Called upon successful reconnect.
         *
         * @private
         */
        onreconnect() {
            const attempt = this.backoff.attempts;
            this._reconnecting = false;
            this.backoff.reset();
            this.emitReserved("reconnect", attempt);
        }
    }

    /**
     * Managers cache.
     */
    const cache = {};
    function lookup(uri, opts) {
        if (typeof uri === "object") {
            opts = uri;
            uri = undefined;
        }
        opts = opts || {};
        const parsed = url(uri, opts.path || "/socket.io");
        const source = parsed.source;
        const id = parsed.id;
        const path = parsed.path;
        const sameNamespace = cache[id] && path in cache[id]["nsps"];
        const newConnection = opts.forceNew ||
            opts["force new connection"] ||
            false === opts.multiplex ||
            sameNamespace;
        let io;
        if (newConnection) {
            io = new Manager(source, opts);
        }
        else {
            if (!cache[id]) {
                cache[id] = new Manager(source, opts);
            }
            io = cache[id];
        }
        if (parsed.query && !opts.query) {
            opts.query = parsed.queryKey;
        }
        return io.socket(parsed.path, opts);
    }
    // so that "lookup" can be used both as a function (e.g. `io(...)`) and as a
    // namespace (e.g. `io.connect(...)`), for backward compatibility
    Object.assign(lookup, {
        Manager,
        Socket,
        io: lookup,
        connect: lookup,
    });

    window.socket = lookup();

    async function mainClient() {
        window.socket.on("connect", () => {
            console.log(window.socket.id);
        });
    }
      
    window.addEventListener("load", (event) => {
        mainClient();
        /*navigator.geolocation.getCurrentPosition((s) => {
            alert(s.coords.latitude);
        });*/

        document.getElementById("btn").addEventListener("click", () => {
            window.location.href = "/login";
        });
    });

})();
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYnVuZGxlLmpzIiwic291cmNlcyI6WyIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLXBhcnNlci9idWlsZC9lc20vY29tbW9ucy5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tcGFyc2VyL2J1aWxkL2VzbS9lbmNvZGVQYWNrZXQuYnJvd3Nlci5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tcGFyc2VyL2J1aWxkL2VzbS9jb250cmliL2Jhc2U2NC1hcnJheWJ1ZmZlci5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tcGFyc2VyL2J1aWxkL2VzbS9kZWNvZGVQYWNrZXQuYnJvd3Nlci5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tcGFyc2VyL2J1aWxkL2VzbS9pbmRleC5qcyIsIi4uL25vZGVfbW9kdWxlcy9Ac29ja2V0LmlvL2NvbXBvbmVudC1lbWl0dGVyL2xpYi9lc20vaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9idWlsZC9lc20vZ2xvYmFsVGhpcy5icm93c2VyLmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1jbGllbnQvYnVpbGQvZXNtL3V0aWwuanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9idWlsZC9lc20vY29udHJpYi9wYXJzZXFzLmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1jbGllbnQvYnVpbGQvZXNtL3RyYW5zcG9ydC5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tY2xpZW50L2J1aWxkL2VzbS9jb250cmliL3llYXN0LmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1jbGllbnQvYnVpbGQvZXNtL2NvbnRyaWIvaGFzLWNvcnMuanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9idWlsZC9lc20vdHJhbnNwb3J0cy94bWxodHRwcmVxdWVzdC5icm93c2VyLmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1jbGllbnQvYnVpbGQvZXNtL3RyYW5zcG9ydHMvcG9sbGluZy5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tY2xpZW50L2J1aWxkL2VzbS90cmFuc3BvcnRzL3dlYnNvY2tldC1jb25zdHJ1Y3Rvci5icm93c2VyLmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1jbGllbnQvYnVpbGQvZXNtL3RyYW5zcG9ydHMvd2Vic29ja2V0LmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1jbGllbnQvYnVpbGQvZXNtL3RyYW5zcG9ydHMvd2VidHJhbnNwb3J0LmpzIiwiLi4vbm9kZV9tb2R1bGVzL2VuZ2luZS5pby1jbGllbnQvYnVpbGQvZXNtL3RyYW5zcG9ydHMvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvZW5naW5lLmlvLWNsaWVudC9idWlsZC9lc20vY29udHJpYi9wYXJzZXVyaS5qcyIsIi4uL25vZGVfbW9kdWxlcy9lbmdpbmUuaW8tY2xpZW50L2J1aWxkL2VzbS9zb2NrZXQuanMiLCIuLi9ub2RlX21vZHVsZXMvc29ja2V0LmlvLWNsaWVudC9idWlsZC9lc20vdXJsLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1wYXJzZXIvYnVpbGQvZXNtL2lzLWJpbmFyeS5qcyIsIi4uL25vZGVfbW9kdWxlcy9zb2NrZXQuaW8tcGFyc2VyL2J1aWxkL2VzbS9iaW5hcnkuanMiLCIuLi9ub2RlX21vZHVsZXMvc29ja2V0LmlvLXBhcnNlci9idWlsZC9lc20vaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvc29ja2V0LmlvLWNsaWVudC9idWlsZC9lc20vb24uanMiLCIuLi9ub2RlX21vZHVsZXMvc29ja2V0LmlvLWNsaWVudC9idWlsZC9lc20vc29ja2V0LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1jbGllbnQvYnVpbGQvZXNtL2NvbnRyaWIvYmFja28yLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3NvY2tldC5pby1jbGllbnQvYnVpbGQvZXNtL21hbmFnZXIuanMiLCIuLi9ub2RlX21vZHVsZXMvc29ja2V0LmlvLWNsaWVudC9idWlsZC9lc20vaW5kZXguanMiLCIuLi9jbGllbnQvY2xpZW50LmpzIl0sInNvdXJjZXNDb250ZW50IjpbImNvbnN0IFBBQ0tFVF9UWVBFUyA9IE9iamVjdC5jcmVhdGUobnVsbCk7IC8vIG5vIE1hcCA9IG5vIHBvbHlmaWxsXG5QQUNLRVRfVFlQRVNbXCJvcGVuXCJdID0gXCIwXCI7XG5QQUNLRVRfVFlQRVNbXCJjbG9zZVwiXSA9IFwiMVwiO1xuUEFDS0VUX1RZUEVTW1wicGluZ1wiXSA9IFwiMlwiO1xuUEFDS0VUX1RZUEVTW1wicG9uZ1wiXSA9IFwiM1wiO1xuUEFDS0VUX1RZUEVTW1wibWVzc2FnZVwiXSA9IFwiNFwiO1xuUEFDS0VUX1RZUEVTW1widXBncmFkZVwiXSA9IFwiNVwiO1xuUEFDS0VUX1RZUEVTW1wibm9vcFwiXSA9IFwiNlwiO1xuY29uc3QgUEFDS0VUX1RZUEVTX1JFVkVSU0UgPSBPYmplY3QuY3JlYXRlKG51bGwpO1xuT2JqZWN0LmtleXMoUEFDS0VUX1RZUEVTKS5mb3JFYWNoKChrZXkpID0+IHtcbiAgICBQQUNLRVRfVFlQRVNfUkVWRVJTRVtQQUNLRVRfVFlQRVNba2V5XV0gPSBrZXk7XG59KTtcbmNvbnN0IEVSUk9SX1BBQ0tFVCA9IHsgdHlwZTogXCJlcnJvclwiLCBkYXRhOiBcInBhcnNlciBlcnJvclwiIH07XG5leHBvcnQgeyBQQUNLRVRfVFlQRVMsIFBBQ0tFVF9UWVBFU19SRVZFUlNFLCBFUlJPUl9QQUNLRVQgfTtcbiIsImltcG9ydCB7IFBBQ0tFVF9UWVBFUyB9IGZyb20gXCIuL2NvbW1vbnMuanNcIjtcbmNvbnN0IHdpdGhOYXRpdmVCbG9iID0gdHlwZW9mIEJsb2IgPT09IFwiZnVuY3Rpb25cIiB8fFxuICAgICh0eXBlb2YgQmxvYiAhPT0gXCJ1bmRlZmluZWRcIiAmJlxuICAgICAgICBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLmNhbGwoQmxvYikgPT09IFwiW29iamVjdCBCbG9iQ29uc3RydWN0b3JdXCIpO1xuY29uc3Qgd2l0aE5hdGl2ZUFycmF5QnVmZmVyID0gdHlwZW9mIEFycmF5QnVmZmVyID09PSBcImZ1bmN0aW9uXCI7XG4vLyBBcnJheUJ1ZmZlci5pc1ZpZXcgbWV0aG9kIGlzIG5vdCBkZWZpbmVkIGluIElFMTBcbmNvbnN0IGlzVmlldyA9IChvYmopID0+IHtcbiAgICByZXR1cm4gdHlwZW9mIEFycmF5QnVmZmVyLmlzVmlldyA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgID8gQXJyYXlCdWZmZXIuaXNWaWV3KG9iailcbiAgICAgICAgOiBvYmogJiYgb2JqLmJ1ZmZlciBpbnN0YW5jZW9mIEFycmF5QnVmZmVyO1xufTtcbmNvbnN0IGVuY29kZVBhY2tldCA9ICh7IHR5cGUsIGRhdGEgfSwgc3VwcG9ydHNCaW5hcnksIGNhbGxiYWNrKSA9PiB7XG4gICAgaWYgKHdpdGhOYXRpdmVCbG9iICYmIGRhdGEgaW5zdGFuY2VvZiBCbG9iKSB7XG4gICAgICAgIGlmIChzdXBwb3J0c0JpbmFyeSkge1xuICAgICAgICAgICAgcmV0dXJuIGNhbGxiYWNrKGRhdGEpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIGVuY29kZUJsb2JBc0Jhc2U2NChkYXRhLCBjYWxsYmFjayk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZWxzZSBpZiAod2l0aE5hdGl2ZUFycmF5QnVmZmVyICYmXG4gICAgICAgIChkYXRhIGluc3RhbmNlb2YgQXJyYXlCdWZmZXIgfHwgaXNWaWV3KGRhdGEpKSkge1xuICAgICAgICBpZiAoc3VwcG9ydHNCaW5hcnkpIHtcbiAgICAgICAgICAgIHJldHVybiBjYWxsYmFjayhkYXRhKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBlbmNvZGVCbG9iQXNCYXNlNjQobmV3IEJsb2IoW2RhdGFdKSwgY2FsbGJhY2spO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8vIHBsYWluIHN0cmluZ1xuICAgIHJldHVybiBjYWxsYmFjayhQQUNLRVRfVFlQRVNbdHlwZV0gKyAoZGF0YSB8fCBcIlwiKSk7XG59O1xuY29uc3QgZW5jb2RlQmxvYkFzQmFzZTY0ID0gKGRhdGEsIGNhbGxiYWNrKSA9PiB7XG4gICAgY29uc3QgZmlsZVJlYWRlciA9IG5ldyBGaWxlUmVhZGVyKCk7XG4gICAgZmlsZVJlYWRlci5vbmxvYWQgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBmaWxlUmVhZGVyLnJlc3VsdC5zcGxpdChcIixcIilbMV07XG4gICAgICAgIGNhbGxiYWNrKFwiYlwiICsgKGNvbnRlbnQgfHwgXCJcIikpO1xuICAgIH07XG4gICAgcmV0dXJuIGZpbGVSZWFkZXIucmVhZEFzRGF0YVVSTChkYXRhKTtcbn07XG5mdW5jdGlvbiB0b0FycmF5KGRhdGEpIHtcbiAgICBpZiAoZGF0YSBpbnN0YW5jZW9mIFVpbnQ4QXJyYXkpIHtcbiAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgfVxuICAgIGVsc2UgaWYgKGRhdGEgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xuICAgICAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoZGF0YSk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoZGF0YS5idWZmZXIsIGRhdGEuYnl0ZU9mZnNldCwgZGF0YS5ieXRlTGVuZ3RoKTtcbiAgICB9XG59XG5sZXQgVEVYVF9FTkNPREVSO1xuZXhwb3J0IGZ1bmN0aW9uIGVuY29kZVBhY2tldFRvQmluYXJ5KHBhY2tldCwgY2FsbGJhY2spIHtcbiAgICBpZiAod2l0aE5hdGl2ZUJsb2IgJiYgcGFja2V0LmRhdGEgaW5zdGFuY2VvZiBCbG9iKSB7XG4gICAgICAgIHJldHVybiBwYWNrZXQuZGF0YS5hcnJheUJ1ZmZlcigpLnRoZW4odG9BcnJheSkudGhlbihjYWxsYmFjayk7XG4gICAgfVxuICAgIGVsc2UgaWYgKHdpdGhOYXRpdmVBcnJheUJ1ZmZlciAmJlxuICAgICAgICAocGFja2V0LmRhdGEgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlciB8fCBpc1ZpZXcocGFja2V0LmRhdGEpKSkge1xuICAgICAgICByZXR1cm4gY2FsbGJhY2sodG9BcnJheShwYWNrZXQuZGF0YSkpO1xuICAgIH1cbiAgICBlbmNvZGVQYWNrZXQocGFja2V0LCBmYWxzZSwgKGVuY29kZWQpID0+IHtcbiAgICAgICAgaWYgKCFURVhUX0VOQ09ERVIpIHtcbiAgICAgICAgICAgIFRFWFRfRU5DT0RFUiA9IG5ldyBUZXh0RW5jb2RlcigpO1xuICAgICAgICB9XG4gICAgICAgIGNhbGxiYWNrKFRFWFRfRU5DT0RFUi5lbmNvZGUoZW5jb2RlZCkpO1xuICAgIH0pO1xufVxuZXhwb3J0IHsgZW5jb2RlUGFja2V0IH07XG4iLCIvLyBpbXBvcnRlZCBmcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9zb2NrZXRpby9iYXNlNjQtYXJyYXlidWZmZXJcbmNvbnN0IGNoYXJzID0gJ0FCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXowMTIzNDU2Nzg5Ky8nO1xuLy8gVXNlIGEgbG9va3VwIHRhYmxlIHRvIGZpbmQgdGhlIGluZGV4LlxuY29uc3QgbG9va3VwID0gdHlwZW9mIFVpbnQ4QXJyYXkgPT09ICd1bmRlZmluZWQnID8gW10gOiBuZXcgVWludDhBcnJheSgyNTYpO1xuZm9yIChsZXQgaSA9IDA7IGkgPCBjaGFycy5sZW5ndGg7IGkrKykge1xuICAgIGxvb2t1cFtjaGFycy5jaGFyQ29kZUF0KGkpXSA9IGk7XG59XG5leHBvcnQgY29uc3QgZW5jb2RlID0gKGFycmF5YnVmZmVyKSA9PiB7XG4gICAgbGV0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYXJyYXlidWZmZXIpLCBpLCBsZW4gPSBieXRlcy5sZW5ndGgsIGJhc2U2NCA9ICcnO1xuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkgKz0gMykge1xuICAgICAgICBiYXNlNjQgKz0gY2hhcnNbYnl0ZXNbaV0gPj4gMl07XG4gICAgICAgIGJhc2U2NCArPSBjaGFyc1soKGJ5dGVzW2ldICYgMykgPDwgNCkgfCAoYnl0ZXNbaSArIDFdID4+IDQpXTtcbiAgICAgICAgYmFzZTY0ICs9IGNoYXJzWygoYnl0ZXNbaSArIDFdICYgMTUpIDw8IDIpIHwgKGJ5dGVzW2kgKyAyXSA+PiA2KV07XG4gICAgICAgIGJhc2U2NCArPSBjaGFyc1tieXRlc1tpICsgMl0gJiA2M107XG4gICAgfVxuICAgIGlmIChsZW4gJSAzID09PSAyKSB7XG4gICAgICAgIGJhc2U2NCA9IGJhc2U2NC5zdWJzdHJpbmcoMCwgYmFzZTY0Lmxlbmd0aCAtIDEpICsgJz0nO1xuICAgIH1cbiAgICBlbHNlIGlmIChsZW4gJSAzID09PSAxKSB7XG4gICAgICAgIGJhc2U2NCA9IGJhc2U2NC5zdWJzdHJpbmcoMCwgYmFzZTY0Lmxlbmd0aCAtIDIpICsgJz09JztcbiAgICB9XG4gICAgcmV0dXJuIGJhc2U2NDtcbn07XG5leHBvcnQgY29uc3QgZGVjb2RlID0gKGJhc2U2NCkgPT4ge1xuICAgIGxldCBidWZmZXJMZW5ndGggPSBiYXNlNjQubGVuZ3RoICogMC43NSwgbGVuID0gYmFzZTY0Lmxlbmd0aCwgaSwgcCA9IDAsIGVuY29kZWQxLCBlbmNvZGVkMiwgZW5jb2RlZDMsIGVuY29kZWQ0O1xuICAgIGlmIChiYXNlNjRbYmFzZTY0Lmxlbmd0aCAtIDFdID09PSAnPScpIHtcbiAgICAgICAgYnVmZmVyTGVuZ3RoLS07XG4gICAgICAgIGlmIChiYXNlNjRbYmFzZTY0Lmxlbmd0aCAtIDJdID09PSAnPScpIHtcbiAgICAgICAgICAgIGJ1ZmZlckxlbmd0aC0tO1xuICAgICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGFycmF5YnVmZmVyID0gbmV3IEFycmF5QnVmZmVyKGJ1ZmZlckxlbmd0aCksIGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYXJyYXlidWZmZXIpO1xuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkgKz0gNCkge1xuICAgICAgICBlbmNvZGVkMSA9IGxvb2t1cFtiYXNlNjQuY2hhckNvZGVBdChpKV07XG4gICAgICAgIGVuY29kZWQyID0gbG9va3VwW2Jhc2U2NC5jaGFyQ29kZUF0KGkgKyAxKV07XG4gICAgICAgIGVuY29kZWQzID0gbG9va3VwW2Jhc2U2NC5jaGFyQ29kZUF0KGkgKyAyKV07XG4gICAgICAgIGVuY29kZWQ0ID0gbG9va3VwW2Jhc2U2NC5jaGFyQ29kZUF0KGkgKyAzKV07XG4gICAgICAgIGJ5dGVzW3ArK10gPSAoZW5jb2RlZDEgPDwgMikgfCAoZW5jb2RlZDIgPj4gNCk7XG4gICAgICAgIGJ5dGVzW3ArK10gPSAoKGVuY29kZWQyICYgMTUpIDw8IDQpIHwgKGVuY29kZWQzID4+IDIpO1xuICAgICAgICBieXRlc1twKytdID0gKChlbmNvZGVkMyAmIDMpIDw8IDYpIHwgKGVuY29kZWQ0ICYgNjMpO1xuICAgIH1cbiAgICByZXR1cm4gYXJyYXlidWZmZXI7XG59O1xuIiwiaW1wb3J0IHsgRVJST1JfUEFDS0VULCBQQUNLRVRfVFlQRVNfUkVWRVJTRSwgfSBmcm9tIFwiLi9jb21tb25zLmpzXCI7XG5pbXBvcnQgeyBkZWNvZGUgfSBmcm9tIFwiLi9jb250cmliL2Jhc2U2NC1hcnJheWJ1ZmZlci5qc1wiO1xuY29uc3Qgd2l0aE5hdGl2ZUFycmF5QnVmZmVyID0gdHlwZW9mIEFycmF5QnVmZmVyID09PSBcImZ1bmN0aW9uXCI7XG5leHBvcnQgY29uc3QgZGVjb2RlUGFja2V0ID0gKGVuY29kZWRQYWNrZXQsIGJpbmFyeVR5cGUpID0+IHtcbiAgICBpZiAodHlwZW9mIGVuY29kZWRQYWNrZXQgIT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIHR5cGU6IFwibWVzc2FnZVwiLFxuICAgICAgICAgICAgZGF0YTogbWFwQmluYXJ5KGVuY29kZWRQYWNrZXQsIGJpbmFyeVR5cGUpLFxuICAgICAgICB9O1xuICAgIH1cbiAgICBjb25zdCB0eXBlID0gZW5jb2RlZFBhY2tldC5jaGFyQXQoMCk7XG4gICAgaWYgKHR5cGUgPT09IFwiYlwiKSB7XG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICB0eXBlOiBcIm1lc3NhZ2VcIixcbiAgICAgICAgICAgIGRhdGE6IGRlY29kZUJhc2U2NFBhY2tldChlbmNvZGVkUGFja2V0LnN1YnN0cmluZygxKSwgYmluYXJ5VHlwZSksXG4gICAgICAgIH07XG4gICAgfVxuICAgIGNvbnN0IHBhY2tldFR5cGUgPSBQQUNLRVRfVFlQRVNfUkVWRVJTRVt0eXBlXTtcbiAgICBpZiAoIXBhY2tldFR5cGUpIHtcbiAgICAgICAgcmV0dXJuIEVSUk9SX1BBQ0tFVDtcbiAgICB9XG4gICAgcmV0dXJuIGVuY29kZWRQYWNrZXQubGVuZ3RoID4gMVxuICAgICAgICA/IHtcbiAgICAgICAgICAgIHR5cGU6IFBBQ0tFVF9UWVBFU19SRVZFUlNFW3R5cGVdLFxuICAgICAgICAgICAgZGF0YTogZW5jb2RlZFBhY2tldC5zdWJzdHJpbmcoMSksXG4gICAgICAgIH1cbiAgICAgICAgOiB7XG4gICAgICAgICAgICB0eXBlOiBQQUNLRVRfVFlQRVNfUkVWRVJTRVt0eXBlXSxcbiAgICAgICAgfTtcbn07XG5jb25zdCBkZWNvZGVCYXNlNjRQYWNrZXQgPSAoZGF0YSwgYmluYXJ5VHlwZSkgPT4ge1xuICAgIGlmICh3aXRoTmF0aXZlQXJyYXlCdWZmZXIpIHtcbiAgICAgICAgY29uc3QgZGVjb2RlZCA9IGRlY29kZShkYXRhKTtcbiAgICAgICAgcmV0dXJuIG1hcEJpbmFyeShkZWNvZGVkLCBiaW5hcnlUeXBlKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHJldHVybiB7IGJhc2U2NDogdHJ1ZSwgZGF0YSB9OyAvLyBmYWxsYmFjayBmb3Igb2xkIGJyb3dzZXJzXG4gICAgfVxufTtcbmNvbnN0IG1hcEJpbmFyeSA9IChkYXRhLCBiaW5hcnlUeXBlKSA9PiB7XG4gICAgc3dpdGNoIChiaW5hcnlUeXBlKSB7XG4gICAgICAgIGNhc2UgXCJibG9iXCI6XG4gICAgICAgICAgICBpZiAoZGF0YSBpbnN0YW5jZW9mIEJsb2IpIHtcbiAgICAgICAgICAgICAgICAvLyBmcm9tIFdlYlNvY2tldCArIGJpbmFyeVR5cGUgXCJibG9iXCJcbiAgICAgICAgICAgICAgICByZXR1cm4gZGF0YTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIGZyb20gSFRUUCBsb25nLXBvbGxpbmcgb3IgV2ViVHJhbnNwb3J0XG4gICAgICAgICAgICAgICAgcmV0dXJuIG5ldyBCbG9iKFtkYXRhXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIGNhc2UgXCJhcnJheWJ1ZmZlclwiOlxuICAgICAgICBkZWZhdWx0OlxuICAgICAgICAgICAgaWYgKGRhdGEgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xuICAgICAgICAgICAgICAgIC8vIGZyb20gSFRUUCBsb25nLXBvbGxpbmcgKGJhc2U2NCkgb3IgV2ViU29ja2V0ICsgYmluYXJ5VHlwZSBcImFycmF5YnVmZmVyXCJcbiAgICAgICAgICAgICAgICByZXR1cm4gZGF0YTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIGZyb20gV2ViVHJhbnNwb3J0IChVaW50OEFycmF5KVxuICAgICAgICAgICAgICAgIHJldHVybiBkYXRhLmJ1ZmZlcjtcbiAgICAgICAgICAgIH1cbiAgICB9XG59O1xuIiwiaW1wb3J0IHsgZW5jb2RlUGFja2V0LCBlbmNvZGVQYWNrZXRUb0JpbmFyeSB9IGZyb20gXCIuL2VuY29kZVBhY2tldC5qc1wiO1xuaW1wb3J0IHsgZGVjb2RlUGFja2V0IH0gZnJvbSBcIi4vZGVjb2RlUGFja2V0LmpzXCI7XG5pbXBvcnQgeyBFUlJPUl9QQUNLRVQsIH0gZnJvbSBcIi4vY29tbW9ucy5qc1wiO1xuY29uc3QgU0VQQVJBVE9SID0gU3RyaW5nLmZyb21DaGFyQ29kZSgzMCk7IC8vIHNlZSBodHRwczovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9EZWxpbWl0ZXIjQVNDSUlfZGVsaW1pdGVkX3RleHRcbmNvbnN0IGVuY29kZVBheWxvYWQgPSAocGFja2V0cywgY2FsbGJhY2spID0+IHtcbiAgICAvLyBzb21lIHBhY2tldHMgbWF5IGJlIGFkZGVkIHRvIHRoZSBhcnJheSB3aGlsZSBlbmNvZGluZywgc28gdGhlIGluaXRpYWwgbGVuZ3RoIG11c3QgYmUgc2F2ZWRcbiAgICBjb25zdCBsZW5ndGggPSBwYWNrZXRzLmxlbmd0aDtcbiAgICBjb25zdCBlbmNvZGVkUGFja2V0cyA9IG5ldyBBcnJheShsZW5ndGgpO1xuICAgIGxldCBjb3VudCA9IDA7XG4gICAgcGFja2V0cy5mb3JFYWNoKChwYWNrZXQsIGkpID0+IHtcbiAgICAgICAgLy8gZm9yY2UgYmFzZTY0IGVuY29kaW5nIGZvciBiaW5hcnkgcGFja2V0c1xuICAgICAgICBlbmNvZGVQYWNrZXQocGFja2V0LCBmYWxzZSwgKGVuY29kZWRQYWNrZXQpID0+IHtcbiAgICAgICAgICAgIGVuY29kZWRQYWNrZXRzW2ldID0gZW5jb2RlZFBhY2tldDtcbiAgICAgICAgICAgIGlmICgrK2NvdW50ID09PSBsZW5ndGgpIHtcbiAgICAgICAgICAgICAgICBjYWxsYmFjayhlbmNvZGVkUGFja2V0cy5qb2luKFNFUEFSQVRPUikpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9KTtcbn07XG5jb25zdCBkZWNvZGVQYXlsb2FkID0gKGVuY29kZWRQYXlsb2FkLCBiaW5hcnlUeXBlKSA9PiB7XG4gICAgY29uc3QgZW5jb2RlZFBhY2tldHMgPSBlbmNvZGVkUGF5bG9hZC5zcGxpdChTRVBBUkFUT1IpO1xuICAgIGNvbnN0IHBhY2tldHMgPSBbXTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGVuY29kZWRQYWNrZXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIGNvbnN0IGRlY29kZWRQYWNrZXQgPSBkZWNvZGVQYWNrZXQoZW5jb2RlZFBhY2tldHNbaV0sIGJpbmFyeVR5cGUpO1xuICAgICAgICBwYWNrZXRzLnB1c2goZGVjb2RlZFBhY2tldCk7XG4gICAgICAgIGlmIChkZWNvZGVkUGFja2V0LnR5cGUgPT09IFwiZXJyb3JcIikge1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHBhY2tldHM7XG59O1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVBhY2tldEVuY29kZXJTdHJlYW0oKSB7XG4gICAgLy8gQHRzLWV4cGVjdC1lcnJvclxuICAgIHJldHVybiBuZXcgVHJhbnNmb3JtU3RyZWFtKHtcbiAgICAgICAgdHJhbnNmb3JtKHBhY2tldCwgY29udHJvbGxlcikge1xuICAgICAgICAgICAgZW5jb2RlUGFja2V0VG9CaW5hcnkocGFja2V0LCAoZW5jb2RlZFBhY2tldCkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IHBheWxvYWRMZW5ndGggPSBlbmNvZGVkUGFja2V0Lmxlbmd0aDtcbiAgICAgICAgICAgICAgICBsZXQgaGVhZGVyO1xuICAgICAgICAgICAgICAgIC8vIGluc3BpcmVkIGJ5IHRoZSBXZWJTb2NrZXQgZm9ybWF0OiBodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9BUEkvV2ViU29ja2V0c19BUEkvV3JpdGluZ19XZWJTb2NrZXRfc2VydmVycyNkZWNvZGluZ19wYXlsb2FkX2xlbmd0aFxuICAgICAgICAgICAgICAgIGlmIChwYXlsb2FkTGVuZ3RoIDwgMTI2KSB7XG4gICAgICAgICAgICAgICAgICAgIGhlYWRlciA9IG5ldyBVaW50OEFycmF5KDEpO1xuICAgICAgICAgICAgICAgICAgICBuZXcgRGF0YVZpZXcoaGVhZGVyLmJ1ZmZlcikuc2V0VWludDgoMCwgcGF5bG9hZExlbmd0aCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2UgaWYgKHBheWxvYWRMZW5ndGggPCA2NTUzNikge1xuICAgICAgICAgICAgICAgICAgICBoZWFkZXIgPSBuZXcgVWludDhBcnJheSgzKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdmlldyA9IG5ldyBEYXRhVmlldyhoZWFkZXIuYnVmZmVyKTtcbiAgICAgICAgICAgICAgICAgICAgdmlldy5zZXRVaW50OCgwLCAxMjYpO1xuICAgICAgICAgICAgICAgICAgICB2aWV3LnNldFVpbnQxNigxLCBwYXlsb2FkTGVuZ3RoKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGhlYWRlciA9IG5ldyBVaW50OEFycmF5KDkpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCB2aWV3ID0gbmV3IERhdGFWaWV3KGhlYWRlci5idWZmZXIpO1xuICAgICAgICAgICAgICAgICAgICB2aWV3LnNldFVpbnQ4KDAsIDEyNyk7XG4gICAgICAgICAgICAgICAgICAgIHZpZXcuc2V0QmlnVWludDY0KDEsIEJpZ0ludChwYXlsb2FkTGVuZ3RoKSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIC8vIGZpcnN0IGJpdCBpbmRpY2F0ZXMgd2hldGhlciB0aGUgcGF5bG9hZCBpcyBwbGFpbiB0ZXh0ICgwKSBvciBiaW5hcnkgKDEpXG4gICAgICAgICAgICAgICAgaWYgKHBhY2tldC5kYXRhICYmIHR5cGVvZiBwYWNrZXQuZGF0YSAhPT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgICAgICAgICBoZWFkZXJbMF0gfD0gMHg4MDtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29udHJvbGxlci5lbnF1ZXVlKGhlYWRlcik7XG4gICAgICAgICAgICAgICAgY29udHJvbGxlci5lbnF1ZXVlKGVuY29kZWRQYWNrZXQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0sXG4gICAgfSk7XG59XG5sZXQgVEVYVF9ERUNPREVSO1xuZnVuY3Rpb24gdG90YWxMZW5ndGgoY2h1bmtzKSB7XG4gICAgcmV0dXJuIGNodW5rcy5yZWR1Y2UoKGFjYywgY2h1bmspID0+IGFjYyArIGNodW5rLmxlbmd0aCwgMCk7XG59XG5mdW5jdGlvbiBjb25jYXRDaHVua3MoY2h1bmtzLCBzaXplKSB7XG4gICAgaWYgKGNodW5rc1swXS5sZW5ndGggPT09IHNpemUpIHtcbiAgICAgICAgcmV0dXJuIGNodW5rcy5zaGlmdCgpO1xuICAgIH1cbiAgICBjb25zdCBidWZmZXIgPSBuZXcgVWludDhBcnJheShzaXplKTtcbiAgICBsZXQgaiA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzaXplOyBpKyspIHtcbiAgICAgICAgYnVmZmVyW2ldID0gY2h1bmtzWzBdW2orK107XG4gICAgICAgIGlmIChqID09PSBjaHVua3NbMF0ubGVuZ3RoKSB7XG4gICAgICAgICAgICBjaHVua3Muc2hpZnQoKTtcbiAgICAgICAgICAgIGogPSAwO1xuICAgICAgICB9XG4gICAgfVxuICAgIGlmIChjaHVua3MubGVuZ3RoICYmIGogPCBjaHVua3NbMF0ubGVuZ3RoKSB7XG4gICAgICAgIGNodW5rc1swXSA9IGNodW5rc1swXS5zbGljZShqKTtcbiAgICB9XG4gICAgcmV0dXJuIGJ1ZmZlcjtcbn1cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVQYWNrZXREZWNvZGVyU3RyZWFtKG1heFBheWxvYWQsIGJpbmFyeVR5cGUpIHtcbiAgICBpZiAoIVRFWFRfREVDT0RFUikge1xuICAgICAgICBURVhUX0RFQ09ERVIgPSBuZXcgVGV4dERlY29kZXIoKTtcbiAgICB9XG4gICAgY29uc3QgY2h1bmtzID0gW107XG4gICAgbGV0IHN0YXRlID0gMCAvKiBSRUFEX0hFQURFUiAqLztcbiAgICBsZXQgZXhwZWN0ZWRMZW5ndGggPSAtMTtcbiAgICBsZXQgaXNCaW5hcnkgPSBmYWxzZTtcbiAgICAvLyBAdHMtZXhwZWN0LWVycm9yXG4gICAgcmV0dXJuIG5ldyBUcmFuc2Zvcm1TdHJlYW0oe1xuICAgICAgICB0cmFuc2Zvcm0oY2h1bmssIGNvbnRyb2xsZXIpIHtcbiAgICAgICAgICAgIGNodW5rcy5wdXNoKGNodW5rKTtcbiAgICAgICAgICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICAgICAgICAgICAgaWYgKHN0YXRlID09PSAwIC8qIFJFQURfSEVBREVSICovKSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0b3RhbExlbmd0aChjaHVua3MpIDwgMSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgY29uc3QgaGVhZGVyID0gY29uY2F0Q2h1bmtzKGNodW5rcywgMSk7XG4gICAgICAgICAgICAgICAgICAgIGlzQmluYXJ5ID0gKGhlYWRlclswXSAmIDB4ODApID09PSAweDgwO1xuICAgICAgICAgICAgICAgICAgICBleHBlY3RlZExlbmd0aCA9IGhlYWRlclswXSAmIDB4N2Y7XG4gICAgICAgICAgICAgICAgICAgIGlmIChleHBlY3RlZExlbmd0aCA8IDEyNikge1xuICAgICAgICAgICAgICAgICAgICAgICAgc3RhdGUgPSAzIC8qIFJFQURfUEFZTE9BRCAqLztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIGlmIChleHBlY3RlZExlbmd0aCA9PT0gMTI2KSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZSA9IDEgLyogUkVBRF9FWFRFTkRFRF9MRU5HVEhfMTYgKi87XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzdGF0ZSA9IDIgLyogUkVBRF9FWFRFTkRFRF9MRU5HVEhfNjQgKi87XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSBpZiAoc3RhdGUgPT09IDEgLyogUkVBRF9FWFRFTkRFRF9MRU5HVEhfMTYgKi8pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRvdGFsTGVuZ3RoKGNodW5rcykgPCAyKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBjb25zdCBoZWFkZXJBcnJheSA9IGNvbmNhdENodW5rcyhjaHVua3MsIDIpO1xuICAgICAgICAgICAgICAgICAgICBleHBlY3RlZExlbmd0aCA9IG5ldyBEYXRhVmlldyhoZWFkZXJBcnJheS5idWZmZXIsIGhlYWRlckFycmF5LmJ5dGVPZmZzZXQsIGhlYWRlckFycmF5Lmxlbmd0aCkuZ2V0VWludDE2KDApO1xuICAgICAgICAgICAgICAgICAgICBzdGF0ZSA9IDMgLyogUkVBRF9QQVlMT0FEICovO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIGlmIChzdGF0ZSA9PT0gMiAvKiBSRUFEX0VYVEVOREVEX0xFTkdUSF82NCAqLykge1xuICAgICAgICAgICAgICAgICAgICBpZiAodG90YWxMZW5ndGgoY2h1bmtzKSA8IDgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGhlYWRlckFycmF5ID0gY29uY2F0Q2h1bmtzKGNodW5rcywgOCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHZpZXcgPSBuZXcgRGF0YVZpZXcoaGVhZGVyQXJyYXkuYnVmZmVyLCBoZWFkZXJBcnJheS5ieXRlT2Zmc2V0LCBoZWFkZXJBcnJheS5sZW5ndGgpO1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBuID0gdmlldy5nZXRVaW50MzIoMCk7XG4gICAgICAgICAgICAgICAgICAgIGlmIChuID4gTWF0aC5wb3coMiwgNTMgLSAzMikgLSAxKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgbWF4aW11bSBzYWZlIGludGVnZXIgaW4gSmF2YVNjcmlwdCBpcyAyXjUzIC0gMVxuICAgICAgICAgICAgICAgICAgICAgICAgY29udHJvbGxlci5lbnF1ZXVlKEVSUk9SX1BBQ0tFVCk7XG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBleHBlY3RlZExlbmd0aCA9IG4gKiBNYXRoLnBvdygyLCAzMikgKyB2aWV3LmdldFVpbnQzMig0KTtcbiAgICAgICAgICAgICAgICAgICAgc3RhdGUgPSAzIC8qIFJFQURfUEFZTE9BRCAqLztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGlmICh0b3RhbExlbmd0aChjaHVua3MpIDwgZXhwZWN0ZWRMZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGRhdGEgPSBjb25jYXRDaHVua3MoY2h1bmtzLCBleHBlY3RlZExlbmd0aCk7XG4gICAgICAgICAgICAgICAgICAgIGNvbnRyb2xsZXIuZW5xdWV1ZShkZWNvZGVQYWNrZXQoaXNCaW5hcnkgPyBkYXRhIDogVEVYVF9ERUNPREVSLmRlY29kZShkYXRhKSwgYmluYXJ5VHlwZSkpO1xuICAgICAgICAgICAgICAgICAgICBzdGF0ZSA9IDAgLyogUkVBRF9IRUFERVIgKi87XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChleHBlY3RlZExlbmd0aCA9PT0gMCB8fCBleHBlY3RlZExlbmd0aCA+IG1heFBheWxvYWQpIHtcbiAgICAgICAgICAgICAgICAgICAgY29udHJvbGxlci5lbnF1ZXVlKEVSUk9SX1BBQ0tFVCk7XG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICB9KTtcbn1cbmV4cG9ydCBjb25zdCBwcm90b2NvbCA9IDQ7XG5leHBvcnQgeyBlbmNvZGVQYWNrZXQsIGVuY29kZVBheWxvYWQsIGRlY29kZVBhY2tldCwgZGVjb2RlUGF5bG9hZCwgfTtcbiIsIi8qKlxuICogSW5pdGlhbGl6ZSBhIG5ldyBgRW1pdHRlcmAuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5leHBvcnQgZnVuY3Rpb24gRW1pdHRlcihvYmopIHtcbiAgaWYgKG9iaikgcmV0dXJuIG1peGluKG9iaik7XG59XG5cbi8qKlxuICogTWl4aW4gdGhlIGVtaXR0ZXIgcHJvcGVydGllcy5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqXG4gKiBAcmV0dXJuIHtPYmplY3R9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBtaXhpbihvYmopIHtcbiAgZm9yICh2YXIga2V5IGluIEVtaXR0ZXIucHJvdG90eXBlKSB7XG4gICAgb2JqW2tleV0gPSBFbWl0dGVyLnByb3RvdHlwZVtrZXldO1xuICB9XG4gIHJldHVybiBvYmo7XG59XG5cbi8qKlxuICogTGlzdGVuIG9uIHRoZSBnaXZlbiBgZXZlbnRgIHdpdGggYGZuYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5FbWl0dGVyLnByb3RvdHlwZS5vbiA9XG5FbWl0dGVyLnByb3RvdHlwZS5hZGRFdmVudExpc3RlbmVyID0gZnVuY3Rpb24oZXZlbnQsIGZuKXtcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xuICAodGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XSA9IHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF0gfHwgW10pXG4gICAgLnB1c2goZm4pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogQWRkcyBhbiBgZXZlbnRgIGxpc3RlbmVyIHRoYXQgd2lsbCBiZSBpbnZva2VkIGEgc2luZ2xlXG4gKiB0aW1lIHRoZW4gYXV0b21hdGljYWxseSByZW1vdmVkLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEByZXR1cm4ge0VtaXR0ZXJ9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLm9uY2UgPSBmdW5jdGlvbihldmVudCwgZm4pe1xuICBmdW5jdGlvbiBvbigpIHtcbiAgICB0aGlzLm9mZihldmVudCwgb24pO1xuICAgIGZuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gIH1cblxuICBvbi5mbiA9IGZuO1xuICB0aGlzLm9uKGV2ZW50LCBvbik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBSZW1vdmUgdGhlIGdpdmVuIGNhbGxiYWNrIGZvciBgZXZlbnRgIG9yIGFsbFxuICogcmVnaXN0ZXJlZCBjYWxsYmFja3MuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7RW1pdHRlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUub2ZmID1cbkVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyID1cbkVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUFsbExpc3RlbmVycyA9XG5FbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVFdmVudExpc3RlbmVyID0gZnVuY3Rpb24oZXZlbnQsIGZuKXtcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xuXG4gIC8vIGFsbFxuICBpZiAoMCA9PSBhcmd1bWVudHMubGVuZ3RoKSB7XG4gICAgdGhpcy5fY2FsbGJhY2tzID0ge307XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyBzcGVjaWZpYyBldmVudFxuICB2YXIgY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XTtcbiAgaWYgKCFjYWxsYmFja3MpIHJldHVybiB0aGlzO1xuXG4gIC8vIHJlbW92ZSBhbGwgaGFuZGxlcnNcbiAgaWYgKDEgPT0gYXJndW1lbnRzLmxlbmd0aCkge1xuICAgIGRlbGV0ZSB0aGlzLl9jYWxsYmFja3NbJyQnICsgZXZlbnRdO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gcmVtb3ZlIHNwZWNpZmljIGhhbmRsZXJcbiAgdmFyIGNiO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGNhbGxiYWNrcy5sZW5ndGg7IGkrKykge1xuICAgIGNiID0gY2FsbGJhY2tzW2ldO1xuICAgIGlmIChjYiA9PT0gZm4gfHwgY2IuZm4gPT09IGZuKSB7XG4gICAgICBjYWxsYmFja3Muc3BsaWNlKGksIDEpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgLy8gUmVtb3ZlIGV2ZW50IHNwZWNpZmljIGFycmF5cyBmb3IgZXZlbnQgdHlwZXMgdGhhdCBub1xuICAvLyBvbmUgaXMgc3Vic2NyaWJlZCBmb3IgdG8gYXZvaWQgbWVtb3J5IGxlYWsuXG4gIGlmIChjYWxsYmFja3MubGVuZ3RoID09PSAwKSB7XG4gICAgZGVsZXRlIHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF07XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogRW1pdCBgZXZlbnRgIHdpdGggdGhlIGdpdmVuIGFyZ3MuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcGFyYW0ge01peGVkfSAuLi5cbiAqIEByZXR1cm4ge0VtaXR0ZXJ9XG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUuZW1pdCA9IGZ1bmN0aW9uKGV2ZW50KXtcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xuXG4gIHZhciBhcmdzID0gbmV3IEFycmF5KGFyZ3VtZW50cy5sZW5ndGggLSAxKVxuICAgICwgY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XTtcblxuICBmb3IgKHZhciBpID0gMTsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICB9XG5cbiAgaWYgKGNhbGxiYWNrcykge1xuICAgIGNhbGxiYWNrcyA9IGNhbGxiYWNrcy5zbGljZSgwKTtcbiAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gY2FsbGJhY2tzLmxlbmd0aDsgaSA8IGxlbjsgKytpKSB7XG4gICAgICBjYWxsYmFja3NbaV0uYXBwbHkodGhpcywgYXJncyk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vLyBhbGlhcyB1c2VkIGZvciByZXNlcnZlZCBldmVudHMgKHByb3RlY3RlZCBtZXRob2QpXG5FbWl0dGVyLnByb3RvdHlwZS5lbWl0UmVzZXJ2ZWQgPSBFbWl0dGVyLnByb3RvdHlwZS5lbWl0O1xuXG4vKipcbiAqIFJldHVybiBhcnJheSBvZiBjYWxsYmFja3MgZm9yIGBldmVudGAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcmV0dXJuIHtBcnJheX1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJzID0gZnVuY3Rpb24oZXZlbnQpe1xuICB0aGlzLl9jYWxsYmFja3MgPSB0aGlzLl9jYWxsYmFja3MgfHwge307XG4gIHJldHVybiB0aGlzLl9jYWxsYmFja3NbJyQnICsgZXZlbnRdIHx8IFtdO1xufTtcblxuLyoqXG4gKiBDaGVjayBpZiB0aGlzIGVtaXR0ZXIgaGFzIGBldmVudGAgaGFuZGxlcnMuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5FbWl0dGVyLnByb3RvdHlwZS5oYXNMaXN0ZW5lcnMgPSBmdW5jdGlvbihldmVudCl7XG4gIHJldHVybiAhISB0aGlzLmxpc3RlbmVycyhldmVudCkubGVuZ3RoO1xufTtcbiIsImV4cG9ydCBjb25zdCBnbG9iYWxUaGlzU2hpbSA9ICgoKSA9PiB7XG4gICAgaWYgKHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIHJldHVybiBzZWxmO1xuICAgIH1cbiAgICBlbHNlIGlmICh0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgIHJldHVybiB3aW5kb3c7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgICByZXR1cm4gRnVuY3Rpb24oXCJyZXR1cm4gdGhpc1wiKSgpO1xuICAgIH1cbn0pKCk7XG4iLCJpbXBvcnQgeyBnbG9iYWxUaGlzU2hpbSBhcyBnbG9iYWxUaGlzIH0gZnJvbSBcIi4vZ2xvYmFsVGhpcy5qc1wiO1xuZXhwb3J0IGZ1bmN0aW9uIHBpY2sob2JqLCAuLi5hdHRyKSB7XG4gICAgcmV0dXJuIGF0dHIucmVkdWNlKChhY2MsIGspID0+IHtcbiAgICAgICAgaWYgKG9iai5oYXNPd25Qcm9wZXJ0eShrKSkge1xuICAgICAgICAgICAgYWNjW2tdID0gb2JqW2tdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBhY2M7XG4gICAgfSwge30pO1xufVxuLy8gS2VlcCBhIHJlZmVyZW5jZSB0byB0aGUgcmVhbCB0aW1lb3V0IGZ1bmN0aW9ucyBzbyB0aGV5IGNhbiBiZSB1c2VkIHdoZW4gb3ZlcnJpZGRlblxuY29uc3QgTkFUSVZFX1NFVF9USU1FT1VUID0gZ2xvYmFsVGhpcy5zZXRUaW1lb3V0O1xuY29uc3QgTkFUSVZFX0NMRUFSX1RJTUVPVVQgPSBnbG9iYWxUaGlzLmNsZWFyVGltZW91dDtcbmV4cG9ydCBmdW5jdGlvbiBpbnN0YWxsVGltZXJGdW5jdGlvbnMob2JqLCBvcHRzKSB7XG4gICAgaWYgKG9wdHMudXNlTmF0aXZlVGltZXJzKSB7XG4gICAgICAgIG9iai5zZXRUaW1lb3V0Rm4gPSBOQVRJVkVfU0VUX1RJTUVPVVQuYmluZChnbG9iYWxUaGlzKTtcbiAgICAgICAgb2JqLmNsZWFyVGltZW91dEZuID0gTkFUSVZFX0NMRUFSX1RJTUVPVVQuYmluZChnbG9iYWxUaGlzKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIG9iai5zZXRUaW1lb3V0Rm4gPSBnbG9iYWxUaGlzLnNldFRpbWVvdXQuYmluZChnbG9iYWxUaGlzKTtcbiAgICAgICAgb2JqLmNsZWFyVGltZW91dEZuID0gZ2xvYmFsVGhpcy5jbGVhclRpbWVvdXQuYmluZChnbG9iYWxUaGlzKTtcbiAgICB9XG59XG4vLyBiYXNlNjQgZW5jb2RlZCBidWZmZXJzIGFyZSBhYm91dCAzMyUgYmlnZ2VyIChodHRwczovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9CYXNlNjQpXG5jb25zdCBCQVNFNjRfT1ZFUkhFQUQgPSAxLjMzO1xuLy8gd2UgY291bGQgYWxzbyBoYXZlIHVzZWQgYG5ldyBCbG9iKFtvYmpdKS5zaXplYCwgYnV0IGl0IGlzbid0IHN1cHBvcnRlZCBpbiBJRTlcbmV4cG9ydCBmdW5jdGlvbiBieXRlTGVuZ3RoKG9iaikge1xuICAgIGlmICh0eXBlb2Ygb2JqID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgIHJldHVybiB1dGY4TGVuZ3RoKG9iaik7XG4gICAgfVxuICAgIC8vIGFycmF5YnVmZmVyIG9yIGJsb2JcbiAgICByZXR1cm4gTWF0aC5jZWlsKChvYmouYnl0ZUxlbmd0aCB8fCBvYmouc2l6ZSkgKiBCQVNFNjRfT1ZFUkhFQUQpO1xufVxuZnVuY3Rpb24gdXRmOExlbmd0aChzdHIpIHtcbiAgICBsZXQgYyA9IDAsIGxlbmd0aCA9IDA7XG4gICAgZm9yIChsZXQgaSA9IDAsIGwgPSBzdHIubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIGMgPSBzdHIuY2hhckNvZGVBdChpKTtcbiAgICAgICAgaWYgKGMgPCAweDgwKSB7XG4gICAgICAgICAgICBsZW5ndGggKz0gMTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChjIDwgMHg4MDApIHtcbiAgICAgICAgICAgIGxlbmd0aCArPSAyO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKGMgPCAweGQ4MDAgfHwgYyA+PSAweGUwMDApIHtcbiAgICAgICAgICAgIGxlbmd0aCArPSAzO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgaSsrO1xuICAgICAgICAgICAgbGVuZ3RoICs9IDQ7XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGxlbmd0aDtcbn1cbiIsIi8vIGltcG9ydGVkIGZyb20gaHR0cHM6Ly9naXRodWIuY29tL2dhbGtuL3F1ZXJ5c3RyaW5nXG4vKipcbiAqIENvbXBpbGVzIGEgcXVlcnlzdHJpbmdcbiAqIFJldHVybnMgc3RyaW5nIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBvYmplY3RcbiAqXG4gKiBAcGFyYW0ge09iamVjdH1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gZW5jb2RlKG9iaikge1xuICAgIGxldCBzdHIgPSAnJztcbiAgICBmb3IgKGxldCBpIGluIG9iaikge1xuICAgICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KGkpKSB7XG4gICAgICAgICAgICBpZiAoc3RyLmxlbmd0aClcbiAgICAgICAgICAgICAgICBzdHIgKz0gJyYnO1xuICAgICAgICAgICAgc3RyICs9IGVuY29kZVVSSUNvbXBvbmVudChpKSArICc9JyArIGVuY29kZVVSSUNvbXBvbmVudChvYmpbaV0pO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzdHI7XG59XG4vKipcbiAqIFBhcnNlcyBhIHNpbXBsZSBxdWVyeXN0cmluZyBpbnRvIGFuIG9iamVjdFxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBxc1xuICogQGFwaSBwcml2YXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWNvZGUocXMpIHtcbiAgICBsZXQgcXJ5ID0ge307XG4gICAgbGV0IHBhaXJzID0gcXMuc3BsaXQoJyYnKTtcbiAgICBmb3IgKGxldCBpID0gMCwgbCA9IHBhaXJzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICBsZXQgcGFpciA9IHBhaXJzW2ldLnNwbGl0KCc9Jyk7XG4gICAgICAgIHFyeVtkZWNvZGVVUklDb21wb25lbnQocGFpclswXSldID0gZGVjb2RlVVJJQ29tcG9uZW50KHBhaXJbMV0pO1xuICAgIH1cbiAgICByZXR1cm4gcXJ5O1xufVxuIiwiaW1wb3J0IHsgZGVjb2RlUGFja2V0IH0gZnJvbSBcImVuZ2luZS5pby1wYXJzZXJcIjtcbmltcG9ydCB7IEVtaXR0ZXIgfSBmcm9tIFwiQHNvY2tldC5pby9jb21wb25lbnQtZW1pdHRlclwiO1xuaW1wb3J0IHsgaW5zdGFsbFRpbWVyRnVuY3Rpb25zIH0gZnJvbSBcIi4vdXRpbC5qc1wiO1xuaW1wb3J0IHsgZW5jb2RlIH0gZnJvbSBcIi4vY29udHJpYi9wYXJzZXFzLmpzXCI7XG5leHBvcnQgY2xhc3MgVHJhbnNwb3J0RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gICAgY29uc3RydWN0b3IocmVhc29uLCBkZXNjcmlwdGlvbiwgY29udGV4dCkge1xuICAgICAgICBzdXBlcihyZWFzb24pO1xuICAgICAgICB0aGlzLmRlc2NyaXB0aW9uID0gZGVzY3JpcHRpb247XG4gICAgICAgIHRoaXMuY29udGV4dCA9IGNvbnRleHQ7XG4gICAgICAgIHRoaXMudHlwZSA9IFwiVHJhbnNwb3J0RXJyb3JcIjtcbiAgICB9XG59XG5leHBvcnQgY2xhc3MgVHJhbnNwb3J0IGV4dGVuZHMgRW1pdHRlciB7XG4gICAgLyoqXG4gICAgICogVHJhbnNwb3J0IGFic3RyYWN0IGNvbnN0cnVjdG9yLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdHMgLSBvcHRpb25zXG4gICAgICogQHByb3RlY3RlZFxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKG9wdHMpIHtcbiAgICAgICAgc3VwZXIoKTtcbiAgICAgICAgdGhpcy53cml0YWJsZSA9IGZhbHNlO1xuICAgICAgICBpbnN0YWxsVGltZXJGdW5jdGlvbnModGhpcywgb3B0cyk7XG4gICAgICAgIHRoaXMub3B0cyA9IG9wdHM7XG4gICAgICAgIHRoaXMucXVlcnkgPSBvcHRzLnF1ZXJ5O1xuICAgICAgICB0aGlzLnNvY2tldCA9IG9wdHMuc29ja2V0O1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBFbWl0cyBhbiBlcnJvci5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSByZWFzb25cbiAgICAgKiBAcGFyYW0gZGVzY3JpcHRpb25cbiAgICAgKiBAcGFyYW0gY29udGV4dCAtIHRoZSBlcnJvciBjb250ZXh0XG4gICAgICogQHJldHVybiB7VHJhbnNwb3J0fSBmb3IgY2hhaW5pbmdcbiAgICAgKiBAcHJvdGVjdGVkXG4gICAgICovXG4gICAgb25FcnJvcihyZWFzb24sIGRlc2NyaXB0aW9uLCBjb250ZXh0KSB7XG4gICAgICAgIHN1cGVyLmVtaXRSZXNlcnZlZChcImVycm9yXCIsIG5ldyBUcmFuc3BvcnRFcnJvcihyZWFzb24sIGRlc2NyaXB0aW9uLCBjb250ZXh0KSk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBPcGVucyB0aGUgdHJhbnNwb3J0LlxuICAgICAqL1xuICAgIG9wZW4oKSB7XG4gICAgICAgIHRoaXMucmVhZHlTdGF0ZSA9IFwib3BlbmluZ1wiO1xuICAgICAgICB0aGlzLmRvT3BlbigpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2xvc2VzIHRoZSB0cmFuc3BvcnQuXG4gICAgICovXG4gICAgY2xvc2UoKSB7XG4gICAgICAgIGlmICh0aGlzLnJlYWR5U3RhdGUgPT09IFwib3BlbmluZ1wiIHx8IHRoaXMucmVhZHlTdGF0ZSA9PT0gXCJvcGVuXCIpIHtcbiAgICAgICAgICAgIHRoaXMuZG9DbG9zZSgpO1xuICAgICAgICAgICAgdGhpcy5vbkNsb3NlKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNlbmRzIG11bHRpcGxlIHBhY2tldHMuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0FycmF5fSBwYWNrZXRzXG4gICAgICovXG4gICAgc2VuZChwYWNrZXRzKSB7XG4gICAgICAgIGlmICh0aGlzLnJlYWR5U3RhdGUgPT09IFwib3BlblwiKSB7XG4gICAgICAgICAgICB0aGlzLndyaXRlKHBhY2tldHMpO1xuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgLy8gdGhpcyBtaWdodCBoYXBwZW4gaWYgdGhlIHRyYW5zcG9ydCB3YXMgc2lsZW50bHkgY2xvc2VkIGluIHRoZSBiZWZvcmV1bmxvYWQgZXZlbnQgaGFuZGxlclxuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB1cG9uIG9wZW5cbiAgICAgKlxuICAgICAqIEBwcm90ZWN0ZWRcbiAgICAgKi9cbiAgICBvbk9wZW4oKSB7XG4gICAgICAgIHRoaXMucmVhZHlTdGF0ZSA9IFwib3BlblwiO1xuICAgICAgICB0aGlzLndyaXRhYmxlID0gdHJ1ZTtcbiAgICAgICAgc3VwZXIuZW1pdFJlc2VydmVkKFwib3BlblwiKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHdpdGggZGF0YS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSBkYXRhXG4gICAgICogQHByb3RlY3RlZFxuICAgICAqL1xuICAgIG9uRGF0YShkYXRhKSB7XG4gICAgICAgIGNvbnN0IHBhY2tldCA9IGRlY29kZVBhY2tldChkYXRhLCB0aGlzLnNvY2tldC5iaW5hcnlUeXBlKTtcbiAgICAgICAgdGhpcy5vblBhY2tldChwYWNrZXQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgd2l0aCBhIGRlY29kZWQgcGFja2V0LlxuICAgICAqXG4gICAgICogQHByb3RlY3RlZFxuICAgICAqL1xuICAgIG9uUGFja2V0KHBhY2tldCkge1xuICAgICAgICBzdXBlci5lbWl0UmVzZXJ2ZWQoXCJwYWNrZXRcIiwgcGFja2V0KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHVwb24gY2xvc2UuXG4gICAgICpcbiAgICAgKiBAcHJvdGVjdGVkXG4gICAgICovXG4gICAgb25DbG9zZShkZXRhaWxzKSB7XG4gICAgICAgIHRoaXMucmVhZHlTdGF0ZSA9IFwiY2xvc2VkXCI7XG4gICAgICAgIHN1cGVyLmVtaXRSZXNlcnZlZChcImNsb3NlXCIsIGRldGFpbHMpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBQYXVzZXMgdGhlIHRyYW5zcG9ydCwgaW4gb3JkZXIgbm90IHRvIGxvc2UgcGFja2V0cyBkdXJpbmcgYW4gdXBncmFkZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBvblBhdXNlXG4gICAgICovXG4gICAgcGF1c2Uob25QYXVzZSkgeyB9XG4gICAgY3JlYXRlVXJpKHNjaGVtYSwgcXVlcnkgPSB7fSkge1xuICAgICAgICByZXR1cm4gKHNjaGVtYSArXG4gICAgICAgICAgICBcIjovL1wiICtcbiAgICAgICAgICAgIHRoaXMuX2hvc3RuYW1lKCkgK1xuICAgICAgICAgICAgdGhpcy5fcG9ydCgpICtcbiAgICAgICAgICAgIHRoaXMub3B0cy5wYXRoICtcbiAgICAgICAgICAgIHRoaXMuX3F1ZXJ5KHF1ZXJ5KSk7XG4gICAgfVxuICAgIF9ob3N0bmFtZSgpIHtcbiAgICAgICAgY29uc3QgaG9zdG5hbWUgPSB0aGlzLm9wdHMuaG9zdG5hbWU7XG4gICAgICAgIHJldHVybiBob3N0bmFtZS5pbmRleE9mKFwiOlwiKSA9PT0gLTEgPyBob3N0bmFtZSA6IFwiW1wiICsgaG9zdG5hbWUgKyBcIl1cIjtcbiAgICB9XG4gICAgX3BvcnQoKSB7XG4gICAgICAgIGlmICh0aGlzLm9wdHMucG9ydCAmJlxuICAgICAgICAgICAgKCh0aGlzLm9wdHMuc2VjdXJlICYmIE51bWJlcih0aGlzLm9wdHMucG9ydCAhPT0gNDQzKSkgfHxcbiAgICAgICAgICAgICAgICAoIXRoaXMub3B0cy5zZWN1cmUgJiYgTnVtYmVyKHRoaXMub3B0cy5wb3J0KSAhPT0gODApKSkge1xuICAgICAgICAgICAgcmV0dXJuIFwiOlwiICsgdGhpcy5vcHRzLnBvcnQ7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gXCJcIjtcbiAgICAgICAgfVxuICAgIH1cbiAgICBfcXVlcnkocXVlcnkpIHtcbiAgICAgICAgY29uc3QgZW5jb2RlZFF1ZXJ5ID0gZW5jb2RlKHF1ZXJ5KTtcbiAgICAgICAgcmV0dXJuIGVuY29kZWRRdWVyeS5sZW5ndGggPyBcIj9cIiArIGVuY29kZWRRdWVyeSA6IFwiXCI7XG4gICAgfVxufVxuIiwiLy8gaW1wb3J0ZWQgZnJvbSBodHRwczovL2dpdGh1Yi5jb20vdW5zaGlmdGlvL3llYXN0XG4ndXNlIHN0cmljdCc7XG5jb25zdCBhbHBoYWJldCA9ICcwMTIzNDU2Nzg5QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ei1fJy5zcGxpdCgnJyksIGxlbmd0aCA9IDY0LCBtYXAgPSB7fTtcbmxldCBzZWVkID0gMCwgaSA9IDAsIHByZXY7XG4vKipcbiAqIFJldHVybiBhIHN0cmluZyByZXByZXNlbnRpbmcgdGhlIHNwZWNpZmllZCBudW1iZXIuXG4gKlxuICogQHBhcmFtIHtOdW1iZXJ9IG51bSBUaGUgbnVtYmVyIHRvIGNvbnZlcnQuXG4gKiBAcmV0dXJucyB7U3RyaW5nfSBUaGUgc3RyaW5nIHJlcHJlc2VudGF0aW9uIG9mIHRoZSBudW1iZXIuXG4gKiBAYXBpIHB1YmxpY1xuICovXG5leHBvcnQgZnVuY3Rpb24gZW5jb2RlKG51bSkge1xuICAgIGxldCBlbmNvZGVkID0gJyc7XG4gICAgZG8ge1xuICAgICAgICBlbmNvZGVkID0gYWxwaGFiZXRbbnVtICUgbGVuZ3RoXSArIGVuY29kZWQ7XG4gICAgICAgIG51bSA9IE1hdGguZmxvb3IobnVtIC8gbGVuZ3RoKTtcbiAgICB9IHdoaWxlIChudW0gPiAwKTtcbiAgICByZXR1cm4gZW5jb2RlZDtcbn1cbi8qKlxuICogUmV0dXJuIHRoZSBpbnRlZ2VyIHZhbHVlIHNwZWNpZmllZCBieSB0aGUgZ2l2ZW4gc3RyaW5nLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBzdHIgVGhlIHN0cmluZyB0byBjb252ZXJ0LlxuICogQHJldHVybnMge051bWJlcn0gVGhlIGludGVnZXIgdmFsdWUgcmVwcmVzZW50ZWQgYnkgdGhlIHN0cmluZy5cbiAqIEBhcGkgcHVibGljXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWNvZGUoc3RyKSB7XG4gICAgbGV0IGRlY29kZWQgPSAwO1xuICAgIGZvciAoaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgZGVjb2RlZCA9IGRlY29kZWQgKiBsZW5ndGggKyBtYXBbc3RyLmNoYXJBdChpKV07XG4gICAgfVxuICAgIHJldHVybiBkZWNvZGVkO1xufVxuLyoqXG4gKiBZZWFzdDogQSB0aW55IGdyb3dpbmcgaWQgZ2VuZXJhdG9yLlxuICpcbiAqIEByZXR1cm5zIHtTdHJpbmd9IEEgdW5pcXVlIGlkLlxuICogQGFwaSBwdWJsaWNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHllYXN0KCkge1xuICAgIGNvbnN0IG5vdyA9IGVuY29kZSgrbmV3IERhdGUoKSk7XG4gICAgaWYgKG5vdyAhPT0gcHJldilcbiAgICAgICAgcmV0dXJuIHNlZWQgPSAwLCBwcmV2ID0gbm93O1xuICAgIHJldHVybiBub3cgKyAnLicgKyBlbmNvZGUoc2VlZCsrKTtcbn1cbi8vXG4vLyBNYXAgZWFjaCBjaGFyYWN0ZXIgdG8gaXRzIGluZGV4LlxuLy9cbmZvciAoOyBpIDwgbGVuZ3RoOyBpKyspXG4gICAgbWFwW2FscGhhYmV0W2ldXSA9IGk7XG4iLCIvLyBpbXBvcnRlZCBmcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9jb21wb25lbnQvaGFzLWNvcnNcbmxldCB2YWx1ZSA9IGZhbHNlO1xudHJ5IHtcbiAgICB2YWx1ZSA9IHR5cGVvZiBYTUxIdHRwUmVxdWVzdCAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICAgICAgJ3dpdGhDcmVkZW50aWFscycgaW4gbmV3IFhNTEh0dHBSZXF1ZXN0KCk7XG59XG5jYXRjaCAoZXJyKSB7XG4gICAgLy8gaWYgWE1MSHR0cCBzdXBwb3J0IGlzIGRpc2FibGVkIGluIElFIHRoZW4gaXQgd2lsbCB0aHJvd1xuICAgIC8vIHdoZW4gdHJ5aW5nIHRvIGNyZWF0ZVxufVxuZXhwb3J0IGNvbnN0IGhhc0NPUlMgPSB2YWx1ZTtcbiIsIi8vIGJyb3dzZXIgc2hpbSBmb3IgeG1saHR0cHJlcXVlc3QgbW9kdWxlXG5pbXBvcnQgeyBoYXNDT1JTIH0gZnJvbSBcIi4uL2NvbnRyaWIvaGFzLWNvcnMuanNcIjtcbmltcG9ydCB7IGdsb2JhbFRoaXNTaGltIGFzIGdsb2JhbFRoaXMgfSBmcm9tIFwiLi4vZ2xvYmFsVGhpcy5qc1wiO1xuZXhwb3J0IGZ1bmN0aW9uIFhIUihvcHRzKSB7XG4gICAgY29uc3QgeGRvbWFpbiA9IG9wdHMueGRvbWFpbjtcbiAgICAvLyBYTUxIdHRwUmVxdWVzdCBjYW4gYmUgZGlzYWJsZWQgb24gSUVcbiAgICB0cnkge1xuICAgICAgICBpZiAoXCJ1bmRlZmluZWRcIiAhPT0gdHlwZW9mIFhNTEh0dHBSZXF1ZXN0ICYmICgheGRvbWFpbiB8fCBoYXNDT1JTKSkge1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGNhdGNoIChlKSB7IH1cbiAgICBpZiAoIXhkb21haW4pIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgZ2xvYmFsVGhpc1tbXCJBY3RpdmVcIl0uY29uY2F0KFwiT2JqZWN0XCIpLmpvaW4oXCJYXCIpXShcIk1pY3Jvc29mdC5YTUxIVFRQXCIpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlKSB7IH1cbiAgICB9XG59XG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQ29va2llSmFyKCkgeyB9XG4iLCJpbXBvcnQgeyBUcmFuc3BvcnQgfSBmcm9tIFwiLi4vdHJhbnNwb3J0LmpzXCI7XG5pbXBvcnQgeyB5ZWFzdCB9IGZyb20gXCIuLi9jb250cmliL3llYXN0LmpzXCI7XG5pbXBvcnQgeyBlbmNvZGVQYXlsb2FkLCBkZWNvZGVQYXlsb2FkIH0gZnJvbSBcImVuZ2luZS5pby1wYXJzZXJcIjtcbmltcG9ydCB7IGNyZWF0ZUNvb2tpZUphciwgWEhSIGFzIFhNTEh0dHBSZXF1ZXN0LCB9IGZyb20gXCIuL3htbGh0dHByZXF1ZXN0LmpzXCI7XG5pbXBvcnQgeyBFbWl0dGVyIH0gZnJvbSBcIkBzb2NrZXQuaW8vY29tcG9uZW50LWVtaXR0ZXJcIjtcbmltcG9ydCB7IGluc3RhbGxUaW1lckZ1bmN0aW9ucywgcGljayB9IGZyb20gXCIuLi91dGlsLmpzXCI7XG5pbXBvcnQgeyBnbG9iYWxUaGlzU2hpbSBhcyBnbG9iYWxUaGlzIH0gZnJvbSBcIi4uL2dsb2JhbFRoaXMuanNcIjtcbmZ1bmN0aW9uIGVtcHR5KCkgeyB9XG5jb25zdCBoYXNYSFIyID0gKGZ1bmN0aW9uICgpIHtcbiAgICBjb25zdCB4aHIgPSBuZXcgWE1MSHR0cFJlcXVlc3Qoe1xuICAgICAgICB4ZG9tYWluOiBmYWxzZSxcbiAgICB9KTtcbiAgICByZXR1cm4gbnVsbCAhPSB4aHIucmVzcG9uc2VUeXBlO1xufSkoKTtcbmV4cG9ydCBjbGFzcyBQb2xsaW5nIGV4dGVuZHMgVHJhbnNwb3J0IHtcbiAgICAvKipcbiAgICAgKiBYSFIgUG9sbGluZyBjb25zdHJ1Y3Rvci5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRzXG4gICAgICogQHBhY2thZ2VcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcihvcHRzKSB7XG4gICAgICAgIHN1cGVyKG9wdHMpO1xuICAgICAgICB0aGlzLnBvbGxpbmcgPSBmYWxzZTtcbiAgICAgICAgaWYgKHR5cGVvZiBsb2NhdGlvbiAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgY29uc3QgaXNTU0wgPSBcImh0dHBzOlwiID09PSBsb2NhdGlvbi5wcm90b2NvbDtcbiAgICAgICAgICAgIGxldCBwb3J0ID0gbG9jYXRpb24ucG9ydDtcbiAgICAgICAgICAgIC8vIHNvbWUgdXNlciBhZ2VudHMgaGF2ZSBlbXB0eSBgbG9jYXRpb24ucG9ydGBcbiAgICAgICAgICAgIGlmICghcG9ydCkge1xuICAgICAgICAgICAgICAgIHBvcnQgPSBpc1NTTCA/IFwiNDQzXCIgOiBcIjgwXCI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLnhkID1cbiAgICAgICAgICAgICAgICAodHlwZW9mIGxvY2F0aW9uICE9PSBcInVuZGVmaW5lZFwiICYmXG4gICAgICAgICAgICAgICAgICAgIG9wdHMuaG9zdG5hbWUgIT09IGxvY2F0aW9uLmhvc3RuYW1lKSB8fFxuICAgICAgICAgICAgICAgICAgICBwb3J0ICE9PSBvcHRzLnBvcnQ7XG4gICAgICAgIH1cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFhIUiBzdXBwb3J0cyBiaW5hcnlcbiAgICAgICAgICovXG4gICAgICAgIGNvbnN0IGZvcmNlQmFzZTY0ID0gb3B0cyAmJiBvcHRzLmZvcmNlQmFzZTY0O1xuICAgICAgICB0aGlzLnN1cHBvcnRzQmluYXJ5ID0gaGFzWEhSMiAmJiAhZm9yY2VCYXNlNjQ7XG4gICAgICAgIGlmICh0aGlzLm9wdHMud2l0aENyZWRlbnRpYWxzKSB7XG4gICAgICAgICAgICB0aGlzLmNvb2tpZUphciA9IGNyZWF0ZUNvb2tpZUphcigpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGdldCBuYW1lKCkge1xuICAgICAgICByZXR1cm4gXCJwb2xsaW5nXCI7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIE9wZW5zIHRoZSBzb2NrZXQgKHRyaWdnZXJzIHBvbGxpbmcpLiBXZSB3cml0ZSBhIFBJTkcgbWVzc2FnZSB0byBkZXRlcm1pbmVcbiAgICAgKiB3aGVuIHRoZSB0cmFuc3BvcnQgaXMgb3Blbi5cbiAgICAgKlxuICAgICAqIEBwcm90ZWN0ZWRcbiAgICAgKi9cbiAgICBkb09wZW4oKSB7XG4gICAgICAgIHRoaXMucG9sbCgpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBQYXVzZXMgcG9sbGluZy5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IG9uUGF1c2UgLSBjYWxsYmFjayB1cG9uIGJ1ZmZlcnMgYXJlIGZsdXNoZWQgYW5kIHRyYW5zcG9ydCBpcyBwYXVzZWRcbiAgICAgKiBAcGFja2FnZVxuICAgICAqL1xuICAgIHBhdXNlKG9uUGF1c2UpIHtcbiAgICAgICAgdGhpcy5yZWFkeVN0YXRlID0gXCJwYXVzaW5nXCI7XG4gICAgICAgIGNvbnN0IHBhdXNlID0gKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5yZWFkeVN0YXRlID0gXCJwYXVzZWRcIjtcbiAgICAgICAgICAgIG9uUGF1c2UoKTtcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKHRoaXMucG9sbGluZyB8fCAhdGhpcy53cml0YWJsZSkge1xuICAgICAgICAgICAgbGV0IHRvdGFsID0gMDtcbiAgICAgICAgICAgIGlmICh0aGlzLnBvbGxpbmcpIHtcbiAgICAgICAgICAgICAgICB0b3RhbCsrO1xuICAgICAgICAgICAgICAgIHRoaXMub25jZShcInBvbGxDb21wbGV0ZVwiLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIC0tdG90YWwgfHwgcGF1c2UoKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghdGhpcy53cml0YWJsZSkge1xuICAgICAgICAgICAgICAgIHRvdGFsKys7XG4gICAgICAgICAgICAgICAgdGhpcy5vbmNlKFwiZHJhaW5cIiwgZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAtLXRvdGFsIHx8IHBhdXNlKCk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwYXVzZSgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFN0YXJ0cyBwb2xsaW5nIGN5Y2xlLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwb2xsKCkge1xuICAgICAgICB0aGlzLnBvbGxpbmcgPSB0cnVlO1xuICAgICAgICB0aGlzLmRvUG9sbCgpO1xuICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInBvbGxcIik7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIE92ZXJsb2FkcyBvbkRhdGEgdG8gZGV0ZWN0IHBheWxvYWRzLlxuICAgICAqXG4gICAgICogQHByb3RlY3RlZFxuICAgICAqL1xuICAgIG9uRGF0YShkYXRhKSB7XG4gICAgICAgIGNvbnN0IGNhbGxiYWNrID0gKHBhY2tldCkgPT4ge1xuICAgICAgICAgICAgLy8gaWYgaXRzIHRoZSBmaXJzdCBtZXNzYWdlIHdlIGNvbnNpZGVyIHRoZSB0cmFuc3BvcnQgb3BlblxuICAgICAgICAgICAgaWYgKFwib3BlbmluZ1wiID09PSB0aGlzLnJlYWR5U3RhdGUgJiYgcGFja2V0LnR5cGUgPT09IFwib3BlblwiKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5vbk9wZW4oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIGlmIGl0cyBhIGNsb3NlIHBhY2tldCwgd2UgY2xvc2UgdGhlIG9uZ29pbmcgcmVxdWVzdHNcbiAgICAgICAgICAgIGlmIChcImNsb3NlXCIgPT09IHBhY2tldC50eXBlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5vbkNsb3NlKHsgZGVzY3JpcHRpb246IFwidHJhbnNwb3J0IGNsb3NlZCBieSB0aGUgc2VydmVyXCIgfSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gb3RoZXJ3aXNlIGJ5cGFzcyBvbkRhdGEgYW5kIGhhbmRsZSB0aGUgbWVzc2FnZVxuICAgICAgICAgICAgdGhpcy5vblBhY2tldChwYWNrZXQpO1xuICAgICAgICB9O1xuICAgICAgICAvLyBkZWNvZGUgcGF5bG9hZFxuICAgICAgICBkZWNvZGVQYXlsb2FkKGRhdGEsIHRoaXMuc29ja2V0LmJpbmFyeVR5cGUpLmZvckVhY2goY2FsbGJhY2spO1xuICAgICAgICAvLyBpZiBhbiBldmVudCBkaWQgbm90IHRyaWdnZXIgY2xvc2luZ1xuICAgICAgICBpZiAoXCJjbG9zZWRcIiAhPT0gdGhpcy5yZWFkeVN0YXRlKSB7XG4gICAgICAgICAgICAvLyBpZiB3ZSBnb3QgZGF0YSB3ZSdyZSBub3QgcG9sbGluZ1xuICAgICAgICAgICAgdGhpcy5wb2xsaW5nID0gZmFsc2U7XG4gICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInBvbGxDb21wbGV0ZVwiKTtcbiAgICAgICAgICAgIGlmIChcIm9wZW5cIiA9PT0gdGhpcy5yZWFkeVN0YXRlKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5wb2xsKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBGb3IgcG9sbGluZywgc2VuZCBhIGNsb3NlIHBhY2tldC5cbiAgICAgKlxuICAgICAqIEBwcm90ZWN0ZWRcbiAgICAgKi9cbiAgICBkb0Nsb3NlKCkge1xuICAgICAgICBjb25zdCBjbG9zZSA9ICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMud3JpdGUoW3sgdHlwZTogXCJjbG9zZVwiIH1dKTtcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKFwib3BlblwiID09PSB0aGlzLnJlYWR5U3RhdGUpIHtcbiAgICAgICAgICAgIGNsb3NlKCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAvLyBpbiBjYXNlIHdlJ3JlIHRyeWluZyB0byBjbG9zZSB3aGlsZVxuICAgICAgICAgICAgLy8gaGFuZHNoYWtpbmcgaXMgaW4gcHJvZ3Jlc3MgKEdILTE2NClcbiAgICAgICAgICAgIHRoaXMub25jZShcIm9wZW5cIiwgY2xvc2UpO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFdyaXRlcyBhIHBhY2tldHMgcGF5bG9hZC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7QXJyYXl9IHBhY2tldHMgLSBkYXRhIHBhY2tldHNcbiAgICAgKiBAcHJvdGVjdGVkXG4gICAgICovXG4gICAgd3JpdGUocGFja2V0cykge1xuICAgICAgICB0aGlzLndyaXRhYmxlID0gZmFsc2U7XG4gICAgICAgIGVuY29kZVBheWxvYWQocGFja2V0cywgKGRhdGEpID0+IHtcbiAgICAgICAgICAgIHRoaXMuZG9Xcml0ZShkYXRhLCAoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy53cml0YWJsZSA9IHRydWU7XG4gICAgICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJkcmFpblwiKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogR2VuZXJhdGVzIHVyaSBmb3IgY29ubmVjdGlvbi5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgdXJpKCkge1xuICAgICAgICBjb25zdCBzY2hlbWEgPSB0aGlzLm9wdHMuc2VjdXJlID8gXCJodHRwc1wiIDogXCJodHRwXCI7XG4gICAgICAgIGNvbnN0IHF1ZXJ5ID0gdGhpcy5xdWVyeSB8fCB7fTtcbiAgICAgICAgLy8gY2FjaGUgYnVzdGluZyBpcyBmb3JjZWRcbiAgICAgICAgaWYgKGZhbHNlICE9PSB0aGlzLm9wdHMudGltZXN0YW1wUmVxdWVzdHMpIHtcbiAgICAgICAgICAgIHF1ZXJ5W3RoaXMub3B0cy50aW1lc3RhbXBQYXJhbV0gPSB5ZWFzdCgpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5zdXBwb3J0c0JpbmFyeSAmJiAhcXVlcnkuc2lkKSB7XG4gICAgICAgICAgICBxdWVyeS5iNjQgPSAxO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZVVyaShzY2hlbWEsIHF1ZXJ5KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyBhIHJlcXVlc3QuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gbWV0aG9kXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICByZXF1ZXN0KG9wdHMgPSB7fSkge1xuICAgICAgICBPYmplY3QuYXNzaWduKG9wdHMsIHsgeGQ6IHRoaXMueGQsIGNvb2tpZUphcjogdGhpcy5jb29raWVKYXIgfSwgdGhpcy5vcHRzKTtcbiAgICAgICAgcmV0dXJuIG5ldyBSZXF1ZXN0KHRoaXMudXJpKCksIG9wdHMpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTZW5kcyBkYXRhLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IGRhdGEgdG8gc2VuZC5cbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsZWQgdXBvbiBmbHVzaC5cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIGRvV3JpdGUoZGF0YSwgZm4pIHtcbiAgICAgICAgY29uc3QgcmVxID0gdGhpcy5yZXF1ZXN0KHtcbiAgICAgICAgICAgIG1ldGhvZDogXCJQT1NUXCIsXG4gICAgICAgICAgICBkYXRhOiBkYXRhLFxuICAgICAgICB9KTtcbiAgICAgICAgcmVxLm9uKFwic3VjY2Vzc1wiLCBmbik7XG4gICAgICAgIHJlcS5vbihcImVycm9yXCIsICh4aHJTdGF0dXMsIGNvbnRleHQpID0+IHtcbiAgICAgICAgICAgIHRoaXMub25FcnJvcihcInhociBwb3N0IGVycm9yXCIsIHhoclN0YXR1cywgY29udGV4dCk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTdGFydHMgYSBwb2xsIGN5Y2xlLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBkb1BvbGwoKSB7XG4gICAgICAgIGNvbnN0IHJlcSA9IHRoaXMucmVxdWVzdCgpO1xuICAgICAgICByZXEub24oXCJkYXRhXCIsIHRoaXMub25EYXRhLmJpbmQodGhpcykpO1xuICAgICAgICByZXEub24oXCJlcnJvclwiLCAoeGhyU3RhdHVzLCBjb250ZXh0KSA9PiB7XG4gICAgICAgICAgICB0aGlzLm9uRXJyb3IoXCJ4aHIgcG9sbCBlcnJvclwiLCB4aHJTdGF0dXMsIGNvbnRleHQpO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5wb2xsWGhyID0gcmVxO1xuICAgIH1cbn1cbmV4cG9ydCBjbGFzcyBSZXF1ZXN0IGV4dGVuZHMgRW1pdHRlciB7XG4gICAgLyoqXG4gICAgICogUmVxdWVzdCBjb25zdHJ1Y3RvclxuICAgICAqXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnNcbiAgICAgKiBAcGFja2FnZVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHVyaSwgb3B0cykge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICBpbnN0YWxsVGltZXJGdW5jdGlvbnModGhpcywgb3B0cyk7XG4gICAgICAgIHRoaXMub3B0cyA9IG9wdHM7XG4gICAgICAgIHRoaXMubWV0aG9kID0gb3B0cy5tZXRob2QgfHwgXCJHRVRcIjtcbiAgICAgICAgdGhpcy51cmkgPSB1cmk7XG4gICAgICAgIHRoaXMuZGF0YSA9IHVuZGVmaW5lZCAhPT0gb3B0cy5kYXRhID8gb3B0cy5kYXRhIDogbnVsbDtcbiAgICAgICAgdGhpcy5jcmVhdGUoKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ3JlYXRlcyB0aGUgWEhSIG9iamVjdCBhbmQgc2VuZHMgdGhlIHJlcXVlc3QuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIGNyZWF0ZSgpIHtcbiAgICAgICAgdmFyIF9hO1xuICAgICAgICBjb25zdCBvcHRzID0gcGljayh0aGlzLm9wdHMsIFwiYWdlbnRcIiwgXCJwZnhcIiwgXCJrZXlcIiwgXCJwYXNzcGhyYXNlXCIsIFwiY2VydFwiLCBcImNhXCIsIFwiY2lwaGVyc1wiLCBcInJlamVjdFVuYXV0aG9yaXplZFwiLCBcImF1dG9VbnJlZlwiKTtcbiAgICAgICAgb3B0cy54ZG9tYWluID0gISF0aGlzLm9wdHMueGQ7XG4gICAgICAgIGNvbnN0IHhociA9ICh0aGlzLnhociA9IG5ldyBYTUxIdHRwUmVxdWVzdChvcHRzKSk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB4aHIub3Blbih0aGlzLm1ldGhvZCwgdGhpcy51cmksIHRydWUpO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBpZiAodGhpcy5vcHRzLmV4dHJhSGVhZGVycykge1xuICAgICAgICAgICAgICAgICAgICB4aHIuc2V0RGlzYWJsZUhlYWRlckNoZWNrICYmIHhoci5zZXREaXNhYmxlSGVhZGVyQ2hlY2sodHJ1ZSk7XG4gICAgICAgICAgICAgICAgICAgIGZvciAobGV0IGkgaW4gdGhpcy5vcHRzLmV4dHJhSGVhZGVycykge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMub3B0cy5leHRyYUhlYWRlcnMuaGFzT3duUHJvcGVydHkoaSkpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB4aHIuc2V0UmVxdWVzdEhlYWRlcihpLCB0aGlzLm9wdHMuZXh0cmFIZWFkZXJzW2ldKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhdGNoIChlKSB7IH1cbiAgICAgICAgICAgIGlmIChcIlBPU1RcIiA9PT0gdGhpcy5tZXRob2QpIHtcbiAgICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgICAgICB4aHIuc2V0UmVxdWVzdEhlYWRlcihcIkNvbnRlbnQtdHlwZVwiLCBcInRleHQvcGxhaW47Y2hhcnNldD1VVEYtOFwiKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY2F0Y2ggKGUpIHsgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB4aHIuc2V0UmVxdWVzdEhlYWRlcihcIkFjY2VwdFwiLCBcIiovKlwiKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhdGNoIChlKSB7IH1cbiAgICAgICAgICAgIChfYSA9IHRoaXMub3B0cy5jb29raWVKYXIpID09PSBudWxsIHx8IF9hID09PSB2b2lkIDAgPyB2b2lkIDAgOiBfYS5hZGRDb29raWVzKHhocik7XG4gICAgICAgICAgICAvLyBpZTYgY2hlY2tcbiAgICAgICAgICAgIGlmIChcIndpdGhDcmVkZW50aWFsc1wiIGluIHhocikge1xuICAgICAgICAgICAgICAgIHhoci53aXRoQ3JlZGVudGlhbHMgPSB0aGlzLm9wdHMud2l0aENyZWRlbnRpYWxzO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHRoaXMub3B0cy5yZXF1ZXN0VGltZW91dCkge1xuICAgICAgICAgICAgICAgIHhoci50aW1lb3V0ID0gdGhpcy5vcHRzLnJlcXVlc3RUaW1lb3V0O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgeGhyLm9ucmVhZHlzdGF0ZWNoYW5nZSA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICB2YXIgX2E7XG4gICAgICAgICAgICAgICAgaWYgKHhoci5yZWFkeVN0YXRlID09PSAzKSB7XG4gICAgICAgICAgICAgICAgICAgIChfYSA9IHRoaXMub3B0cy5jb29raWVKYXIpID09PSBudWxsIHx8IF9hID09PSB2b2lkIDAgPyB2b2lkIDAgOiBfYS5wYXJzZUNvb2tpZXMoeGhyKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKDQgIT09IHhoci5yZWFkeVN0YXRlKVxuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgaWYgKDIwMCA9PT0geGhyLnN0YXR1cyB8fCAxMjIzID09PSB4aHIuc3RhdHVzKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMub25Mb2FkKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAvLyBtYWtlIHN1cmUgdGhlIGBlcnJvcmAgZXZlbnQgaGFuZGxlciB0aGF0J3MgdXNlci1zZXRcbiAgICAgICAgICAgICAgICAgICAgLy8gZG9lcyBub3QgdGhyb3cgaW4gdGhlIHNhbWUgdGljayBhbmQgZ2V0cyBjYXVnaHQgaGVyZVxuICAgICAgICAgICAgICAgICAgICB0aGlzLnNldFRpbWVvdXRGbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLm9uRXJyb3IodHlwZW9mIHhoci5zdGF0dXMgPT09IFwibnVtYmVyXCIgPyB4aHIuc3RhdHVzIDogMCk7XG4gICAgICAgICAgICAgICAgICAgIH0sIDApO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICB4aHIuc2VuZCh0aGlzLmRhdGEpO1xuICAgICAgICB9XG4gICAgICAgIGNhdGNoIChlKSB7XG4gICAgICAgICAgICAvLyBOZWVkIHRvIGRlZmVyIHNpbmNlIC5jcmVhdGUoKSBpcyBjYWxsZWQgZGlyZWN0bHkgZnJvbSB0aGUgY29uc3RydWN0b3JcbiAgICAgICAgICAgIC8vIGFuZCB0aHVzIHRoZSAnZXJyb3InIGV2ZW50IGNhbiBvbmx5IGJlIG9ubHkgYm91bmQgKmFmdGVyKiB0aGlzIGV4Y2VwdGlvblxuICAgICAgICAgICAgLy8gb2NjdXJzLiAgVGhlcmVmb3JlLCBhbHNvLCB3ZSBjYW5ub3QgdGhyb3cgaGVyZSBhdCBhbGwuXG4gICAgICAgICAgICB0aGlzLnNldFRpbWVvdXRGbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5vbkVycm9yKGUpO1xuICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHR5cGVvZiBkb2N1bWVudCAhPT0gXCJ1bmRlZmluZWRcIikge1xuICAgICAgICAgICAgdGhpcy5pbmRleCA9IFJlcXVlc3QucmVxdWVzdHNDb3VudCsrO1xuICAgICAgICAgICAgUmVxdWVzdC5yZXF1ZXN0c1t0aGlzLmluZGV4XSA9IHRoaXM7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHVwb24gZXJyb3IuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9uRXJyb3IoZXJyKSB7XG4gICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwiZXJyb3JcIiwgZXJyLCB0aGlzLnhocik7XG4gICAgICAgIHRoaXMuY2xlYW51cCh0cnVlKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2xlYW5zIHVwIGhvdXNlLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBjbGVhbnVwKGZyb21FcnJvcikge1xuICAgICAgICBpZiAoXCJ1bmRlZmluZWRcIiA9PT0gdHlwZW9mIHRoaXMueGhyIHx8IG51bGwgPT09IHRoaXMueGhyKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy54aHIub25yZWFkeXN0YXRlY2hhbmdlID0gZW1wdHk7XG4gICAgICAgIGlmIChmcm9tRXJyb3IpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy54aHIuYWJvcnQoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNhdGNoIChlKSB7IH1cbiAgICAgICAgfVxuICAgICAgICBpZiAodHlwZW9mIGRvY3VtZW50ICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgICAgICBkZWxldGUgUmVxdWVzdC5yZXF1ZXN0c1t0aGlzLmluZGV4XTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnhociA9IG51bGw7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB1cG9uIGxvYWQuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9uTG9hZCgpIHtcbiAgICAgICAgY29uc3QgZGF0YSA9IHRoaXMueGhyLnJlc3BvbnNlVGV4dDtcbiAgICAgICAgaWYgKGRhdGEgIT09IG51bGwpIHtcbiAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwiZGF0YVwiLCBkYXRhKTtcbiAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwic3VjY2Vzc1wiKTtcbiAgICAgICAgICAgIHRoaXMuY2xlYW51cCgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEFib3J0cyB0aGUgcmVxdWVzdC5cbiAgICAgKlxuICAgICAqIEBwYWNrYWdlXG4gICAgICovXG4gICAgYWJvcnQoKSB7XG4gICAgICAgIHRoaXMuY2xlYW51cCgpO1xuICAgIH1cbn1cblJlcXVlc3QucmVxdWVzdHNDb3VudCA9IDA7XG5SZXF1ZXN0LnJlcXVlc3RzID0ge307XG4vKipcbiAqIEFib3J0cyBwZW5kaW5nIHJlcXVlc3RzIHdoZW4gdW5sb2FkaW5nIHRoZSB3aW5kb3cuIFRoaXMgaXMgbmVlZGVkIHRvIHByZXZlbnRcbiAqIG1lbW9yeSBsZWFrcyAoZS5nLiB3aGVuIHVzaW5nIElFKSBhbmQgdG8gZW5zdXJlIHRoYXQgbm8gc3B1cmlvdXMgZXJyb3IgaXNcbiAqIGVtaXR0ZWQuXG4gKi9cbmlmICh0eXBlb2YgZG9jdW1lbnQgIT09IFwidW5kZWZpbmVkXCIpIHtcbiAgICAvLyBAdHMtaWdub3JlXG4gICAgaWYgKHR5cGVvZiBhdHRhY2hFdmVudCA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgYXR0YWNoRXZlbnQoXCJvbnVubG9hZFwiLCB1bmxvYWRIYW5kbGVyKTtcbiAgICB9XG4gICAgZWxzZSBpZiAodHlwZW9mIGFkZEV2ZW50TGlzdGVuZXIgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBjb25zdCB0ZXJtaW5hdGlvbkV2ZW50ID0gXCJvbnBhZ2VoaWRlXCIgaW4gZ2xvYmFsVGhpcyA/IFwicGFnZWhpZGVcIiA6IFwidW5sb2FkXCI7XG4gICAgICAgIGFkZEV2ZW50TGlzdGVuZXIodGVybWluYXRpb25FdmVudCwgdW5sb2FkSGFuZGxlciwgZmFsc2UpO1xuICAgIH1cbn1cbmZ1bmN0aW9uIHVubG9hZEhhbmRsZXIoKSB7XG4gICAgZm9yIChsZXQgaSBpbiBSZXF1ZXN0LnJlcXVlc3RzKSB7XG4gICAgICAgIGlmIChSZXF1ZXN0LnJlcXVlc3RzLmhhc093blByb3BlcnR5KGkpKSB7XG4gICAgICAgICAgICBSZXF1ZXN0LnJlcXVlc3RzW2ldLmFib3J0KCk7XG4gICAgICAgIH1cbiAgICB9XG59XG4iLCJpbXBvcnQgeyBnbG9iYWxUaGlzU2hpbSBhcyBnbG9iYWxUaGlzIH0gZnJvbSBcIi4uL2dsb2JhbFRoaXMuanNcIjtcbmV4cG9ydCBjb25zdCBuZXh0VGljayA9ICgoKSA9PiB7XG4gICAgY29uc3QgaXNQcm9taXNlQXZhaWxhYmxlID0gdHlwZW9mIFByb21pc2UgPT09IFwiZnVuY3Rpb25cIiAmJiB0eXBlb2YgUHJvbWlzZS5yZXNvbHZlID09PSBcImZ1bmN0aW9uXCI7XG4gICAgaWYgKGlzUHJvbWlzZUF2YWlsYWJsZSkge1xuICAgICAgICByZXR1cm4gKGNiKSA9PiBQcm9taXNlLnJlc29sdmUoKS50aGVuKGNiKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAgIHJldHVybiAoY2IsIHNldFRpbWVvdXRGbikgPT4gc2V0VGltZW91dEZuKGNiLCAwKTtcbiAgICB9XG59KSgpO1xuZXhwb3J0IGNvbnN0IFdlYlNvY2tldCA9IGdsb2JhbFRoaXMuV2ViU29ja2V0IHx8IGdsb2JhbFRoaXMuTW96V2ViU29ja2V0O1xuZXhwb3J0IGNvbnN0IHVzaW5nQnJvd3NlcldlYlNvY2tldCA9IHRydWU7XG5leHBvcnQgY29uc3QgZGVmYXVsdEJpbmFyeVR5cGUgPSBcImFycmF5YnVmZmVyXCI7XG4iLCJpbXBvcnQgeyBUcmFuc3BvcnQgfSBmcm9tIFwiLi4vdHJhbnNwb3J0LmpzXCI7XG5pbXBvcnQgeyB5ZWFzdCB9IGZyb20gXCIuLi9jb250cmliL3llYXN0LmpzXCI7XG5pbXBvcnQgeyBwaWNrIH0gZnJvbSBcIi4uL3V0aWwuanNcIjtcbmltcG9ydCB7IG5leHRUaWNrLCB1c2luZ0Jyb3dzZXJXZWJTb2NrZXQsIFdlYlNvY2tldCwgfSBmcm9tIFwiLi93ZWJzb2NrZXQtY29uc3RydWN0b3IuanNcIjtcbmltcG9ydCB7IGVuY29kZVBhY2tldCB9IGZyb20gXCJlbmdpbmUuaW8tcGFyc2VyXCI7XG4vLyBkZXRlY3QgUmVhY3ROYXRpdmUgZW52aXJvbm1lbnRcbmNvbnN0IGlzUmVhY3ROYXRpdmUgPSB0eXBlb2YgbmF2aWdhdG9yICE9PSBcInVuZGVmaW5lZFwiICYmXG4gICAgdHlwZW9mIG5hdmlnYXRvci5wcm9kdWN0ID09PSBcInN0cmluZ1wiICYmXG4gICAgbmF2aWdhdG9yLnByb2R1Y3QudG9Mb3dlckNhc2UoKSA9PT0gXCJyZWFjdG5hdGl2ZVwiO1xuZXhwb3J0IGNsYXNzIFdTIGV4dGVuZHMgVHJhbnNwb3J0IHtcbiAgICAvKipcbiAgICAgKiBXZWJTb2NrZXQgdHJhbnNwb3J0IGNvbnN0cnVjdG9yLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdHMgLSBjb25uZWN0aW9uIG9wdGlvbnNcbiAgICAgKiBAcHJvdGVjdGVkXG4gICAgICovXG4gICAgY29uc3RydWN0b3Iob3B0cykge1xuICAgICAgICBzdXBlcihvcHRzKTtcbiAgICAgICAgdGhpcy5zdXBwb3J0c0JpbmFyeSA9ICFvcHRzLmZvcmNlQmFzZTY0O1xuICAgIH1cbiAgICBnZXQgbmFtZSgpIHtcbiAgICAgICAgcmV0dXJuIFwid2Vic29ja2V0XCI7XG4gICAgfVxuICAgIGRvT3BlbigpIHtcbiAgICAgICAgaWYgKCF0aGlzLmNoZWNrKCkpIHtcbiAgICAgICAgICAgIC8vIGxldCBwcm9iZSB0aW1lb3V0XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdXJpID0gdGhpcy51cmkoKTtcbiAgICAgICAgY29uc3QgcHJvdG9jb2xzID0gdGhpcy5vcHRzLnByb3RvY29scztcbiAgICAgICAgLy8gUmVhY3QgTmF0aXZlIG9ubHkgc3VwcG9ydHMgdGhlICdoZWFkZXJzJyBvcHRpb24sIGFuZCB3aWxsIHByaW50IGEgd2FybmluZyBpZiBhbnl0aGluZyBlbHNlIGlzIHBhc3NlZFxuICAgICAgICBjb25zdCBvcHRzID0gaXNSZWFjdE5hdGl2ZVxuICAgICAgICAgICAgPyB7fVxuICAgICAgICAgICAgOiBwaWNrKHRoaXMub3B0cywgXCJhZ2VudFwiLCBcInBlck1lc3NhZ2VEZWZsYXRlXCIsIFwicGZ4XCIsIFwia2V5XCIsIFwicGFzc3BocmFzZVwiLCBcImNlcnRcIiwgXCJjYVwiLCBcImNpcGhlcnNcIiwgXCJyZWplY3RVbmF1dGhvcml6ZWRcIiwgXCJsb2NhbEFkZHJlc3NcIiwgXCJwcm90b2NvbFZlcnNpb25cIiwgXCJvcmlnaW5cIiwgXCJtYXhQYXlsb2FkXCIsIFwiZmFtaWx5XCIsIFwiY2hlY2tTZXJ2ZXJJZGVudGl0eVwiKTtcbiAgICAgICAgaWYgKHRoaXMub3B0cy5leHRyYUhlYWRlcnMpIHtcbiAgICAgICAgICAgIG9wdHMuaGVhZGVycyA9IHRoaXMub3B0cy5leHRyYUhlYWRlcnM7XG4gICAgICAgIH1cbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRoaXMud3MgPVxuICAgICAgICAgICAgICAgIHVzaW5nQnJvd3NlcldlYlNvY2tldCAmJiAhaXNSZWFjdE5hdGl2ZVxuICAgICAgICAgICAgICAgICAgICA/IHByb3RvY29sc1xuICAgICAgICAgICAgICAgICAgICAgICAgPyBuZXcgV2ViU29ja2V0KHVyaSwgcHJvdG9jb2xzKVxuICAgICAgICAgICAgICAgICAgICAgICAgOiBuZXcgV2ViU29ja2V0KHVyaSlcbiAgICAgICAgICAgICAgICAgICAgOiBuZXcgV2ViU29ja2V0KHVyaSwgcHJvdG9jb2xzLCBvcHRzKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZXJyKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5lbWl0UmVzZXJ2ZWQoXCJlcnJvclwiLCBlcnIpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMud3MuYmluYXJ5VHlwZSA9IHRoaXMuc29ja2V0LmJpbmFyeVR5cGU7XG4gICAgICAgIHRoaXMuYWRkRXZlbnRMaXN0ZW5lcnMoKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQWRkcyBldmVudCBsaXN0ZW5lcnMgdG8gdGhlIHNvY2tldFxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBhZGRFdmVudExpc3RlbmVycygpIHtcbiAgICAgICAgdGhpcy53cy5vbm9wZW4gPSAoKSA9PiB7XG4gICAgICAgICAgICBpZiAodGhpcy5vcHRzLmF1dG9VbnJlZikge1xuICAgICAgICAgICAgICAgIHRoaXMud3MuX3NvY2tldC51bnJlZigpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5vbk9wZW4oKTtcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy53cy5vbmNsb3NlID0gKGNsb3NlRXZlbnQpID0+IHRoaXMub25DbG9zZSh7XG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogXCJ3ZWJzb2NrZXQgY29ubmVjdGlvbiBjbG9zZWRcIixcbiAgICAgICAgICAgIGNvbnRleHQ6IGNsb3NlRXZlbnQsXG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLndzLm9ubWVzc2FnZSA9IChldikgPT4gdGhpcy5vbkRhdGEoZXYuZGF0YSk7XG4gICAgICAgIHRoaXMud3Mub25lcnJvciA9IChlKSA9PiB0aGlzLm9uRXJyb3IoXCJ3ZWJzb2NrZXQgZXJyb3JcIiwgZSk7XG4gICAgfVxuICAgIHdyaXRlKHBhY2tldHMpIHtcbiAgICAgICAgdGhpcy53cml0YWJsZSA9IGZhbHNlO1xuICAgICAgICAvLyBlbmNvZGVQYWNrZXQgZWZmaWNpZW50IGFzIGl0IHVzZXMgV1MgZnJhbWluZ1xuICAgICAgICAvLyBubyBuZWVkIGZvciBlbmNvZGVQYXlsb2FkXG4gICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGFja2V0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgY29uc3QgcGFja2V0ID0gcGFja2V0c1tpXTtcbiAgICAgICAgICAgIGNvbnN0IGxhc3RQYWNrZXQgPSBpID09PSBwYWNrZXRzLmxlbmd0aCAtIDE7XG4gICAgICAgICAgICBlbmNvZGVQYWNrZXQocGFja2V0LCB0aGlzLnN1cHBvcnRzQmluYXJ5LCAoZGF0YSkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIGFsd2F5cyBjcmVhdGUgYSBuZXcgb2JqZWN0IChHSC00MzcpXG4gICAgICAgICAgICAgICAgY29uc3Qgb3B0cyA9IHt9O1xuICAgICAgICAgICAgICAgIGlmICghdXNpbmdCcm93c2VyV2ViU29ja2V0KSB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChwYWNrZXQub3B0aW9ucykge1xuICAgICAgICAgICAgICAgICAgICAgICAgb3B0cy5jb21wcmVzcyA9IHBhY2tldC5vcHRpb25zLmNvbXByZXNzO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLm9wdHMucGVyTWVzc2FnZURlZmxhdGUpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxlbiA9IFxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgICAgICAgICAgICAgXCJzdHJpbmdcIiA9PT0gdHlwZW9mIGRhdGEgPyBCdWZmZXIuYnl0ZUxlbmd0aChkYXRhKSA6IGRhdGEubGVuZ3RoO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKGxlbiA8IHRoaXMub3B0cy5wZXJNZXNzYWdlRGVmbGF0ZS50aHJlc2hvbGQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBvcHRzLmNvbXByZXNzID0gZmFsc2U7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgLy8gU29tZXRpbWVzIHRoZSB3ZWJzb2NrZXQgaGFzIGFscmVhZHkgYmVlbiBjbG9zZWQgYnV0IHRoZSBicm93c2VyIGRpZG4ndFxuICAgICAgICAgICAgICAgIC8vIGhhdmUgYSBjaGFuY2Ugb2YgaW5mb3JtaW5nIHVzIGFib3V0IGl0IHlldCwgaW4gdGhhdCBjYXNlIHNlbmQgd2lsbFxuICAgICAgICAgICAgICAgIC8vIHRocm93IGFuIGVycm9yXG4gICAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHVzaW5nQnJvd3NlcldlYlNvY2tldCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgLy8gVHlwZUVycm9yIGlzIHRocm93biB3aGVuIHBhc3NpbmcgdGhlIHNlY29uZCBhcmd1bWVudCBvbiBTYWZhcmlcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMud3Muc2VuZChkYXRhKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMud3Muc2VuZChkYXRhLCBvcHRzKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBpZiAobGFzdFBhY2tldCkge1xuICAgICAgICAgICAgICAgICAgICAvLyBmYWtlIGRyYWluXG4gICAgICAgICAgICAgICAgICAgIC8vIGRlZmVyIHRvIG5leHQgdGljayB0byBhbGxvdyBTb2NrZXQgdG8gY2xlYXIgd3JpdGVCdWZmZXJcbiAgICAgICAgICAgICAgICAgICAgbmV4dFRpY2soKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy53cml0YWJsZSA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcImRyYWluXCIpO1xuICAgICAgICAgICAgICAgICAgICB9LCB0aGlzLnNldFRpbWVvdXRGbik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZG9DbG9zZSgpIHtcbiAgICAgICAgaWYgKHR5cGVvZiB0aGlzLndzICE9PSBcInVuZGVmaW5lZFwiKSB7XG4gICAgICAgICAgICB0aGlzLndzLmNsb3NlKCk7XG4gICAgICAgICAgICB0aGlzLndzID0gbnVsbDtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBHZW5lcmF0ZXMgdXJpIGZvciBjb25uZWN0aW9uLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICB1cmkoKSB7XG4gICAgICAgIGNvbnN0IHNjaGVtYSA9IHRoaXMub3B0cy5zZWN1cmUgPyBcIndzc1wiIDogXCJ3c1wiO1xuICAgICAgICBjb25zdCBxdWVyeSA9IHRoaXMucXVlcnkgfHwge307XG4gICAgICAgIC8vIGFwcGVuZCB0aW1lc3RhbXAgdG8gVVJJXG4gICAgICAgIGlmICh0aGlzLm9wdHMudGltZXN0YW1wUmVxdWVzdHMpIHtcbiAgICAgICAgICAgIHF1ZXJ5W3RoaXMub3B0cy50aW1lc3RhbXBQYXJhbV0gPSB5ZWFzdCgpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGNvbW11bmljYXRlIGJpbmFyeSBzdXBwb3J0IGNhcGFiaWxpdGllc1xuICAgICAgICBpZiAoIXRoaXMuc3VwcG9ydHNCaW5hcnkpIHtcbiAgICAgICAgICAgIHF1ZXJ5LmI2NCA9IDE7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlVXJpKHNjaGVtYSwgcXVlcnkpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBGZWF0dXJlIGRldGVjdGlvbiBmb3IgV2ViU29ja2V0LlxuICAgICAqXG4gICAgICogQHJldHVybiB7Qm9vbGVhbn0gd2hldGhlciB0aGlzIHRyYW5zcG9ydCBpcyBhdmFpbGFibGUuXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBjaGVjaygpIHtcbiAgICAgICAgcmV0dXJuICEhV2ViU29ja2V0O1xuICAgIH1cbn1cbiIsImltcG9ydCB7IFRyYW5zcG9ydCB9IGZyb20gXCIuLi90cmFuc3BvcnQuanNcIjtcbmltcG9ydCB7IG5leHRUaWNrIH0gZnJvbSBcIi4vd2Vic29ja2V0LWNvbnN0cnVjdG9yLmpzXCI7XG5pbXBvcnQgeyBjcmVhdGVQYWNrZXREZWNvZGVyU3RyZWFtLCBjcmVhdGVQYWNrZXRFbmNvZGVyU3RyZWFtLCB9IGZyb20gXCJlbmdpbmUuaW8tcGFyc2VyXCI7XG5leHBvcnQgY2xhc3MgV1QgZXh0ZW5kcyBUcmFuc3BvcnQge1xuICAgIGdldCBuYW1lKCkge1xuICAgICAgICByZXR1cm4gXCJ3ZWJ0cmFuc3BvcnRcIjtcbiAgICB9XG4gICAgZG9PcGVuKCkge1xuICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgIGlmICh0eXBlb2YgV2ViVHJhbnNwb3J0ICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgIHRoaXMudHJhbnNwb3J0ID0gbmV3IFdlYlRyYW5zcG9ydCh0aGlzLmNyZWF0ZVVyaShcImh0dHBzXCIpLCB0aGlzLm9wdHMudHJhbnNwb3J0T3B0aW9uc1t0aGlzLm5hbWVdKTtcbiAgICAgICAgdGhpcy50cmFuc3BvcnQuY2xvc2VkXG4gICAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLm9uQ2xvc2UoKTtcbiAgICAgICAgfSlcbiAgICAgICAgICAgIC5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICAgICAgICB0aGlzLm9uRXJyb3IoXCJ3ZWJ0cmFuc3BvcnQgZXJyb3JcIiwgZXJyKTtcbiAgICAgICAgfSk7XG4gICAgICAgIC8vIG5vdGU6IHdlIGNvdWxkIGhhdmUgdXNlZCBhc3luYy9hd2FpdCwgYnV0IHRoYXQgd291bGQgcmVxdWlyZSBzb21lIGFkZGl0aW9uYWwgcG9seWZpbGxzXG4gICAgICAgIHRoaXMudHJhbnNwb3J0LnJlYWR5LnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy50cmFuc3BvcnQuY3JlYXRlQmlkaXJlY3Rpb25hbFN0cmVhbSgpLnRoZW4oKHN0cmVhbSkgPT4ge1xuICAgICAgICAgICAgICAgIGNvbnN0IGRlY29kZXJTdHJlYW0gPSBjcmVhdGVQYWNrZXREZWNvZGVyU3RyZWFtKE51bWJlci5NQVhfU0FGRV9JTlRFR0VSLCB0aGlzLnNvY2tldC5iaW5hcnlUeXBlKTtcbiAgICAgICAgICAgICAgICBjb25zdCByZWFkZXIgPSBzdHJlYW0ucmVhZGFibGUucGlwZVRocm91Z2goZGVjb2RlclN0cmVhbSkuZ2V0UmVhZGVyKCk7XG4gICAgICAgICAgICAgICAgY29uc3QgZW5jb2RlclN0cmVhbSA9IGNyZWF0ZVBhY2tldEVuY29kZXJTdHJlYW0oKTtcbiAgICAgICAgICAgICAgICBlbmNvZGVyU3RyZWFtLnJlYWRhYmxlLnBpcGVUbyhzdHJlYW0ud3JpdGFibGUpO1xuICAgICAgICAgICAgICAgIHRoaXMud3JpdGVyID0gZW5jb2RlclN0cmVhbS53cml0YWJsZS5nZXRXcml0ZXIoKTtcbiAgICAgICAgICAgICAgICBjb25zdCByZWFkID0gKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICByZWFkZXJcbiAgICAgICAgICAgICAgICAgICAgICAgIC5yZWFkKClcbiAgICAgICAgICAgICAgICAgICAgICAgIC50aGVuKCh7IGRvbmUsIHZhbHVlIH0pID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChkb25lKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5vblBhY2tldCh2YWx1ZSk7XG4gICAgICAgICAgICAgICAgICAgICAgICByZWFkKCk7XG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgICAgICAuY2F0Y2goKGVycikgPT4ge1xuICAgICAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIHJlYWQoKTtcbiAgICAgICAgICAgICAgICBjb25zdCBwYWNrZXQgPSB7IHR5cGU6IFwib3BlblwiIH07XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMucXVlcnkuc2lkKSB7XG4gICAgICAgICAgICAgICAgICAgIHBhY2tldC5kYXRhID0gYHtcInNpZFwiOlwiJHt0aGlzLnF1ZXJ5LnNpZH1cIn1gO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB0aGlzLndyaXRlci53cml0ZShwYWNrZXQpLnRoZW4oKCkgPT4gdGhpcy5vbk9wZW4oKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIHdyaXRlKHBhY2tldHMpIHtcbiAgICAgICAgdGhpcy53cml0YWJsZSA9IGZhbHNlO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBhY2tldHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGNvbnN0IHBhY2tldCA9IHBhY2tldHNbaV07XG4gICAgICAgICAgICBjb25zdCBsYXN0UGFja2V0ID0gaSA9PT0gcGFja2V0cy5sZW5ndGggLSAxO1xuICAgICAgICAgICAgdGhpcy53cml0ZXIud3JpdGUocGFja2V0KS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAobGFzdFBhY2tldCkge1xuICAgICAgICAgICAgICAgICAgICBuZXh0VGljaygoKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLndyaXRhYmxlID0gdHJ1ZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwiZHJhaW5cIik7XG4gICAgICAgICAgICAgICAgICAgIH0sIHRoaXMuc2V0VGltZW91dEZuKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBkb0Nsb3NlKCkge1xuICAgICAgICB2YXIgX2E7XG4gICAgICAgIChfYSA9IHRoaXMudHJhbnNwb3J0KSA9PT0gbnVsbCB8fCBfYSA9PT0gdm9pZCAwID8gdm9pZCAwIDogX2EuY2xvc2UoKTtcbiAgICB9XG59XG4iLCJpbXBvcnQgeyBQb2xsaW5nIH0gZnJvbSBcIi4vcG9sbGluZy5qc1wiO1xuaW1wb3J0IHsgV1MgfSBmcm9tIFwiLi93ZWJzb2NrZXQuanNcIjtcbmltcG9ydCB7IFdUIH0gZnJvbSBcIi4vd2VidHJhbnNwb3J0LmpzXCI7XG5leHBvcnQgY29uc3QgdHJhbnNwb3J0cyA9IHtcbiAgICB3ZWJzb2NrZXQ6IFdTLFxuICAgIHdlYnRyYW5zcG9ydDogV1QsXG4gICAgcG9sbGluZzogUG9sbGluZyxcbn07XG4iLCIvLyBpbXBvcnRlZCBmcm9tIGh0dHBzOi8vZ2l0aHViLmNvbS9nYWxrbi9wYXJzZXVyaVxuLyoqXG4gKiBQYXJzZXMgYSBVUklcbiAqXG4gKiBOb3RlOiB3ZSBjb3VsZCBhbHNvIGhhdmUgdXNlZCB0aGUgYnVpbHQtaW4gVVJMIG9iamVjdCwgYnV0IGl0IGlzbid0IHN1cHBvcnRlZCBvbiBhbGwgcGxhdGZvcm1zLlxuICpcbiAqIFNlZTpcbiAqIC0gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL1VSTFxuICogLSBodHRwczovL2Nhbml1c2UuY29tL3VybFxuICogLSBodHRwczovL3d3dy5yZmMtZWRpdG9yLm9yZy9yZmMvcmZjMzk4NiNhcHBlbmRpeC1CXG4gKlxuICogSGlzdG9yeSBvZiB0aGUgcGFyc2UoKSBtZXRob2Q6XG4gKiAtIGZpcnN0IGNvbW1pdDogaHR0cHM6Ly9naXRodWIuY29tL3NvY2tldGlvL3NvY2tldC5pby1jbGllbnQvY29tbWl0LzRlZTFkNWQ5NGIzOTA2YTljMDUyYjQ1OWYxYTgxOGIxNWYzOGY5MWNcbiAqIC0gZXhwb3J0IGludG8gaXRzIG93biBtb2R1bGU6IGh0dHBzOi8vZ2l0aHViLmNvbS9zb2NrZXRpby9lbmdpbmUuaW8tY2xpZW50L2NvbW1pdC9kZTJjNTYxZTQ1NjRlZmViNzhmMWJkYjFiYTM5ZWY4MWIyODIyY2IzXG4gKiAtIHJlaW1wb3J0OiBodHRwczovL2dpdGh1Yi5jb20vc29ja2V0aW8vZW5naW5lLmlvLWNsaWVudC9jb21taXQvZGYzMjI3N2MzZjZkNjIyZWVjNWVkMDlmNDkzY2FlM2YzMzkxZDI0MlxuICpcbiAqIEBhdXRob3IgU3RldmVuIExldml0aGFuIDxzdGV2ZW5sZXZpdGhhbi5jb20+IChNSVQgbGljZW5zZSlcbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5jb25zdCByZSA9IC9eKD86KD8hW146QFxcLz8jXSs6W146QFxcL10qQCkoaHR0cHxodHRwc3x3c3x3c3MpOlxcL1xcLyk/KCg/OigoW146QFxcLz8jXSopKD86OihbXjpAXFwvPyNdKikpPyk/QCk/KCg/OlthLWYwLTldezAsNH06KXsyLDd9W2EtZjAtOV17MCw0fXxbXjpcXC8/I10qKSg/OjooXFxkKikpPykoKChcXC8oPzpbXj8jXSg/IVtePyNcXC9dKlxcLltePyNcXC8uXSsoPzpbPyNdfCQpKSkqXFwvPyk/KFtePyNcXC9dKikpKD86XFw/KFteI10qKSk/KD86IyguKikpPykvO1xuY29uc3QgcGFydHMgPSBbXG4gICAgJ3NvdXJjZScsICdwcm90b2NvbCcsICdhdXRob3JpdHknLCAndXNlckluZm8nLCAndXNlcicsICdwYXNzd29yZCcsICdob3N0JywgJ3BvcnQnLCAncmVsYXRpdmUnLCAncGF0aCcsICdkaXJlY3RvcnknLCAnZmlsZScsICdxdWVyeScsICdhbmNob3InXG5dO1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlKHN0cikge1xuICAgIGlmIChzdHIubGVuZ3RoID4gMjAwMCkge1xuICAgICAgICB0aHJvdyBcIlVSSSB0b28gbG9uZ1wiO1xuICAgIH1cbiAgICBjb25zdCBzcmMgPSBzdHIsIGIgPSBzdHIuaW5kZXhPZignWycpLCBlID0gc3RyLmluZGV4T2YoJ10nKTtcbiAgICBpZiAoYiAhPSAtMSAmJiBlICE9IC0xKSB7XG4gICAgICAgIHN0ciA9IHN0ci5zdWJzdHJpbmcoMCwgYikgKyBzdHIuc3Vic3RyaW5nKGIsIGUpLnJlcGxhY2UoLzovZywgJzsnKSArIHN0ci5zdWJzdHJpbmcoZSwgc3RyLmxlbmd0aCk7XG4gICAgfVxuICAgIGxldCBtID0gcmUuZXhlYyhzdHIgfHwgJycpLCB1cmkgPSB7fSwgaSA9IDE0O1xuICAgIHdoaWxlIChpLS0pIHtcbiAgICAgICAgdXJpW3BhcnRzW2ldXSA9IG1baV0gfHwgJyc7XG4gICAgfVxuICAgIGlmIChiICE9IC0xICYmIGUgIT0gLTEpIHtcbiAgICAgICAgdXJpLnNvdXJjZSA9IHNyYztcbiAgICAgICAgdXJpLmhvc3QgPSB1cmkuaG9zdC5zdWJzdHJpbmcoMSwgdXJpLmhvc3QubGVuZ3RoIC0gMSkucmVwbGFjZSgvOy9nLCAnOicpO1xuICAgICAgICB1cmkuYXV0aG9yaXR5ID0gdXJpLmF1dGhvcml0eS5yZXBsYWNlKCdbJywgJycpLnJlcGxhY2UoJ10nLCAnJykucmVwbGFjZSgvOy9nLCAnOicpO1xuICAgICAgICB1cmkuaXB2NnVyaSA9IHRydWU7XG4gICAgfVxuICAgIHVyaS5wYXRoTmFtZXMgPSBwYXRoTmFtZXModXJpLCB1cmlbJ3BhdGgnXSk7XG4gICAgdXJpLnF1ZXJ5S2V5ID0gcXVlcnlLZXkodXJpLCB1cmlbJ3F1ZXJ5J10pO1xuICAgIHJldHVybiB1cmk7XG59XG5mdW5jdGlvbiBwYXRoTmFtZXMob2JqLCBwYXRoKSB7XG4gICAgY29uc3QgcmVneCA9IC9cXC97Miw5fS9nLCBuYW1lcyA9IHBhdGgucmVwbGFjZShyZWd4LCBcIi9cIikuc3BsaXQoXCIvXCIpO1xuICAgIGlmIChwYXRoLnNsaWNlKDAsIDEpID09ICcvJyB8fCBwYXRoLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICBuYW1lcy5zcGxpY2UoMCwgMSk7XG4gICAgfVxuICAgIGlmIChwYXRoLnNsaWNlKC0xKSA9PSAnLycpIHtcbiAgICAgICAgbmFtZXMuc3BsaWNlKG5hbWVzLmxlbmd0aCAtIDEsIDEpO1xuICAgIH1cbiAgICByZXR1cm4gbmFtZXM7XG59XG5mdW5jdGlvbiBxdWVyeUtleSh1cmksIHF1ZXJ5KSB7XG4gICAgY29uc3QgZGF0YSA9IHt9O1xuICAgIHF1ZXJ5LnJlcGxhY2UoLyg/Ol58JikoW14mPV0qKT0/KFteJl0qKS9nLCBmdW5jdGlvbiAoJDAsICQxLCAkMikge1xuICAgICAgICBpZiAoJDEpIHtcbiAgICAgICAgICAgIGRhdGFbJDFdID0gJDI7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gZGF0YTtcbn1cbiIsImltcG9ydCB7IHRyYW5zcG9ydHMgfSBmcm9tIFwiLi90cmFuc3BvcnRzL2luZGV4LmpzXCI7XG5pbXBvcnQgeyBpbnN0YWxsVGltZXJGdW5jdGlvbnMsIGJ5dGVMZW5ndGggfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5pbXBvcnQgeyBkZWNvZGUgfSBmcm9tIFwiLi9jb250cmliL3BhcnNlcXMuanNcIjtcbmltcG9ydCB7IHBhcnNlIH0gZnJvbSBcIi4vY29udHJpYi9wYXJzZXVyaS5qc1wiO1xuaW1wb3J0IHsgRW1pdHRlciB9IGZyb20gXCJAc29ja2V0LmlvL2NvbXBvbmVudC1lbWl0dGVyXCI7XG5pbXBvcnQgeyBwcm90b2NvbCB9IGZyb20gXCJlbmdpbmUuaW8tcGFyc2VyXCI7XG5pbXBvcnQgeyBkZWZhdWx0QmluYXJ5VHlwZSB9IGZyb20gXCIuL3RyYW5zcG9ydHMvd2Vic29ja2V0LWNvbnN0cnVjdG9yLmpzXCI7XG5leHBvcnQgY2xhc3MgU29ja2V0IGV4dGVuZHMgRW1pdHRlciB7XG4gICAgLyoqXG4gICAgICogU29ja2V0IGNvbnN0cnVjdG9yLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSB1cmkgLSB1cmkgb3Igb3B0aW9uc1xuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRzIC0gb3B0aW9uc1xuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHVyaSwgb3B0cyA9IHt9KSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMuYmluYXJ5VHlwZSA9IGRlZmF1bHRCaW5hcnlUeXBlO1xuICAgICAgICB0aGlzLndyaXRlQnVmZmVyID0gW107XG4gICAgICAgIGlmICh1cmkgJiYgXCJvYmplY3RcIiA9PT0gdHlwZW9mIHVyaSkge1xuICAgICAgICAgICAgb3B0cyA9IHVyaTtcbiAgICAgICAgICAgIHVyaSA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHVyaSkge1xuICAgICAgICAgICAgdXJpID0gcGFyc2UodXJpKTtcbiAgICAgICAgICAgIG9wdHMuaG9zdG5hbWUgPSB1cmkuaG9zdDtcbiAgICAgICAgICAgIG9wdHMuc2VjdXJlID0gdXJpLnByb3RvY29sID09PSBcImh0dHBzXCIgfHwgdXJpLnByb3RvY29sID09PSBcIndzc1wiO1xuICAgICAgICAgICAgb3B0cy5wb3J0ID0gdXJpLnBvcnQ7XG4gICAgICAgICAgICBpZiAodXJpLnF1ZXJ5KVxuICAgICAgICAgICAgICAgIG9wdHMucXVlcnkgPSB1cmkucXVlcnk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAob3B0cy5ob3N0KSB7XG4gICAgICAgICAgICBvcHRzLmhvc3RuYW1lID0gcGFyc2Uob3B0cy5ob3N0KS5ob3N0O1xuICAgICAgICB9XG4gICAgICAgIGluc3RhbGxUaW1lckZ1bmN0aW9ucyh0aGlzLCBvcHRzKTtcbiAgICAgICAgdGhpcy5zZWN1cmUgPVxuICAgICAgICAgICAgbnVsbCAhPSBvcHRzLnNlY3VyZVxuICAgICAgICAgICAgICAgID8gb3B0cy5zZWN1cmVcbiAgICAgICAgICAgICAgICA6IHR5cGVvZiBsb2NhdGlvbiAhPT0gXCJ1bmRlZmluZWRcIiAmJiBcImh0dHBzOlwiID09PSBsb2NhdGlvbi5wcm90b2NvbDtcbiAgICAgICAgaWYgKG9wdHMuaG9zdG5hbWUgJiYgIW9wdHMucG9ydCkge1xuICAgICAgICAgICAgLy8gaWYgbm8gcG9ydCBpcyBzcGVjaWZpZWQgbWFudWFsbHksIHVzZSB0aGUgcHJvdG9jb2wgZGVmYXVsdFxuICAgICAgICAgICAgb3B0cy5wb3J0ID0gdGhpcy5zZWN1cmUgPyBcIjQ0M1wiIDogXCI4MFwiO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuaG9zdG5hbWUgPVxuICAgICAgICAgICAgb3B0cy5ob3N0bmFtZSB8fFxuICAgICAgICAgICAgICAgICh0eXBlb2YgbG9jYXRpb24gIT09IFwidW5kZWZpbmVkXCIgPyBsb2NhdGlvbi5ob3N0bmFtZSA6IFwibG9jYWxob3N0XCIpO1xuICAgICAgICB0aGlzLnBvcnQgPVxuICAgICAgICAgICAgb3B0cy5wb3J0IHx8XG4gICAgICAgICAgICAgICAgKHR5cGVvZiBsb2NhdGlvbiAhPT0gXCJ1bmRlZmluZWRcIiAmJiBsb2NhdGlvbi5wb3J0XG4gICAgICAgICAgICAgICAgICAgID8gbG9jYXRpb24ucG9ydFxuICAgICAgICAgICAgICAgICAgICA6IHRoaXMuc2VjdXJlXG4gICAgICAgICAgICAgICAgICAgICAgICA/IFwiNDQzXCJcbiAgICAgICAgICAgICAgICAgICAgICAgIDogXCI4MFwiKTtcbiAgICAgICAgdGhpcy50cmFuc3BvcnRzID0gb3B0cy50cmFuc3BvcnRzIHx8IFtcbiAgICAgICAgICAgIFwicG9sbGluZ1wiLFxuICAgICAgICAgICAgXCJ3ZWJzb2NrZXRcIixcbiAgICAgICAgICAgIFwid2VidHJhbnNwb3J0XCIsXG4gICAgICAgIF07XG4gICAgICAgIHRoaXMud3JpdGVCdWZmZXIgPSBbXTtcbiAgICAgICAgdGhpcy5wcmV2QnVmZmVyTGVuID0gMDtcbiAgICAgICAgdGhpcy5vcHRzID0gT2JqZWN0LmFzc2lnbih7XG4gICAgICAgICAgICBwYXRoOiBcIi9lbmdpbmUuaW9cIixcbiAgICAgICAgICAgIGFnZW50OiBmYWxzZSxcbiAgICAgICAgICAgIHdpdGhDcmVkZW50aWFsczogZmFsc2UsXG4gICAgICAgICAgICB1cGdyYWRlOiB0cnVlLFxuICAgICAgICAgICAgdGltZXN0YW1wUGFyYW06IFwidFwiLFxuICAgICAgICAgICAgcmVtZW1iZXJVcGdyYWRlOiBmYWxzZSxcbiAgICAgICAgICAgIGFkZFRyYWlsaW5nU2xhc2g6IHRydWUsXG4gICAgICAgICAgICByZWplY3RVbmF1dGhvcml6ZWQ6IHRydWUsXG4gICAgICAgICAgICBwZXJNZXNzYWdlRGVmbGF0ZToge1xuICAgICAgICAgICAgICAgIHRocmVzaG9sZDogMTAyNCxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICB0cmFuc3BvcnRPcHRpb25zOiB7fSxcbiAgICAgICAgICAgIGNsb3NlT25CZWZvcmV1bmxvYWQ6IGZhbHNlLFxuICAgICAgICB9LCBvcHRzKTtcbiAgICAgICAgdGhpcy5vcHRzLnBhdGggPVxuICAgICAgICAgICAgdGhpcy5vcHRzLnBhdGgucmVwbGFjZSgvXFwvJC8sIFwiXCIpICtcbiAgICAgICAgICAgICAgICAodGhpcy5vcHRzLmFkZFRyYWlsaW5nU2xhc2ggPyBcIi9cIiA6IFwiXCIpO1xuICAgICAgICBpZiAodHlwZW9mIHRoaXMub3B0cy5xdWVyeSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgdGhpcy5vcHRzLnF1ZXJ5ID0gZGVjb2RlKHRoaXMub3B0cy5xdWVyeSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gc2V0IG9uIGhhbmRzaGFrZVxuICAgICAgICB0aGlzLmlkID0gbnVsbDtcbiAgICAgICAgdGhpcy51cGdyYWRlcyA9IG51bGw7XG4gICAgICAgIHRoaXMucGluZ0ludGVydmFsID0gbnVsbDtcbiAgICAgICAgdGhpcy5waW5nVGltZW91dCA9IG51bGw7XG4gICAgICAgIC8vIHNldCBvbiBoZWFydGJlYXRcbiAgICAgICAgdGhpcy5waW5nVGltZW91dFRpbWVyID0gbnVsbDtcbiAgICAgICAgaWYgKHR5cGVvZiBhZGRFdmVudExpc3RlbmVyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIGlmICh0aGlzLm9wdHMuY2xvc2VPbkJlZm9yZXVubG9hZCkge1xuICAgICAgICAgICAgICAgIC8vIEZpcmVmb3ggY2xvc2VzIHRoZSBjb25uZWN0aW9uIHdoZW4gdGhlIFwiYmVmb3JldW5sb2FkXCIgZXZlbnQgaXMgZW1pdHRlZCBidXQgbm90IENocm9tZS4gVGhpcyBldmVudCBsaXN0ZW5lclxuICAgICAgICAgICAgICAgIC8vIGVuc3VyZXMgZXZlcnkgYnJvd3NlciBiZWhhdmVzIHRoZSBzYW1lIChubyBcImRpc2Nvbm5lY3RcIiBldmVudCBhdCB0aGUgU29ja2V0LklPIGxldmVsIHdoZW4gdGhlIHBhZ2UgaXNcbiAgICAgICAgICAgICAgICAvLyBjbG9zZWQvcmVsb2FkZWQpXG4gICAgICAgICAgICAgICAgdGhpcy5iZWZvcmV1bmxvYWRFdmVudExpc3RlbmVyID0gKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgICBpZiAodGhpcy50cmFuc3BvcnQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIHNpbGVudGx5IGNsb3NlIHRoZSB0cmFuc3BvcnRcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMudHJhbnNwb3J0LnJlbW92ZUFsbExpc3RlbmVycygpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy50cmFuc3BvcnQuY2xvc2UoKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgYWRkRXZlbnRMaXN0ZW5lcihcImJlZm9yZXVubG9hZFwiLCB0aGlzLmJlZm9yZXVubG9hZEV2ZW50TGlzdGVuZXIsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0aGlzLmhvc3RuYW1lICE9PSBcImxvY2FsaG9zdFwiKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5vZmZsaW5lRXZlbnRMaXN0ZW5lciA9ICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5vbkNsb3NlKFwidHJhbnNwb3J0IGNsb3NlXCIsIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBcIm5ldHdvcmsgY29ubmVjdGlvbiBsb3N0XCIsXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIH07XG4gICAgICAgICAgICAgICAgYWRkRXZlbnRMaXN0ZW5lcihcIm9mZmxpbmVcIiwgdGhpcy5vZmZsaW5lRXZlbnRMaXN0ZW5lciwgZmFsc2UpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRoaXMub3BlbigpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIHRyYW5zcG9ydCBvZiB0aGUgZ2l2ZW4gdHlwZS5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIC0gdHJhbnNwb3J0IG5hbWVcbiAgICAgKiBAcmV0dXJuIHtUcmFuc3BvcnR9XG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBjcmVhdGVUcmFuc3BvcnQobmFtZSkge1xuICAgICAgICBjb25zdCBxdWVyeSA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMub3B0cy5xdWVyeSk7XG4gICAgICAgIC8vIGFwcGVuZCBlbmdpbmUuaW8gcHJvdG9jb2wgaWRlbnRpZmllclxuICAgICAgICBxdWVyeS5FSU8gPSBwcm90b2NvbDtcbiAgICAgICAgLy8gdHJhbnNwb3J0IG5hbWVcbiAgICAgICAgcXVlcnkudHJhbnNwb3J0ID0gbmFtZTtcbiAgICAgICAgLy8gc2Vzc2lvbiBpZCBpZiB3ZSBhbHJlYWR5IGhhdmUgb25lXG4gICAgICAgIGlmICh0aGlzLmlkKVxuICAgICAgICAgICAgcXVlcnkuc2lkID0gdGhpcy5pZDtcbiAgICAgICAgY29uc3Qgb3B0cyA9IE9iamVjdC5hc3NpZ24oe30sIHRoaXMub3B0cywge1xuICAgICAgICAgICAgcXVlcnksXG4gICAgICAgICAgICBzb2NrZXQ6IHRoaXMsXG4gICAgICAgICAgICBob3N0bmFtZTogdGhpcy5ob3N0bmFtZSxcbiAgICAgICAgICAgIHNlY3VyZTogdGhpcy5zZWN1cmUsXG4gICAgICAgICAgICBwb3J0OiB0aGlzLnBvcnQsXG4gICAgICAgIH0sIHRoaXMub3B0cy50cmFuc3BvcnRPcHRpb25zW25hbWVdKTtcbiAgICAgICAgcmV0dXJuIG5ldyB0cmFuc3BvcnRzW25hbWVdKG9wdHMpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBJbml0aWFsaXplcyB0cmFuc3BvcnQgdG8gdXNlIGFuZCBzdGFydHMgcHJvYmUuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9wZW4oKSB7XG4gICAgICAgIGxldCB0cmFuc3BvcnQ7XG4gICAgICAgIGlmICh0aGlzLm9wdHMucmVtZW1iZXJVcGdyYWRlICYmXG4gICAgICAgICAgICBTb2NrZXQucHJpb3JXZWJzb2NrZXRTdWNjZXNzICYmXG4gICAgICAgICAgICB0aGlzLnRyYW5zcG9ydHMuaW5kZXhPZihcIndlYnNvY2tldFwiKSAhPT0gLTEpIHtcbiAgICAgICAgICAgIHRyYW5zcG9ydCA9IFwid2Vic29ja2V0XCI7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAoMCA9PT0gdGhpcy50cmFuc3BvcnRzLmxlbmd0aCkge1xuICAgICAgICAgICAgLy8gRW1pdCBlcnJvciBvbiBuZXh0IHRpY2sgc28gaXQgY2FuIGJlIGxpc3RlbmVkIHRvXG4gICAgICAgICAgICB0aGlzLnNldFRpbWVvdXRGbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJlcnJvclwiLCBcIk5vIHRyYW5zcG9ydHMgYXZhaWxhYmxlXCIpO1xuICAgICAgICAgICAgfSwgMCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydHNbMF07XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5yZWFkeVN0YXRlID0gXCJvcGVuaW5nXCI7XG4gICAgICAgIC8vIFJldHJ5IHdpdGggdGhlIG5leHQgdHJhbnNwb3J0IGlmIHRoZSB0cmFuc3BvcnQgaXMgZGlzYWJsZWQgKGpzb25wOiBmYWxzZSlcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHRyYW5zcG9ydCA9IHRoaXMuY3JlYXRlVHJhbnNwb3J0KHRyYW5zcG9ydCk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIHRoaXMudHJhbnNwb3J0cy5zaGlmdCgpO1xuICAgICAgICAgICAgdGhpcy5vcGVuKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdHJhbnNwb3J0Lm9wZW4oKTtcbiAgICAgICAgdGhpcy5zZXRUcmFuc3BvcnQodHJhbnNwb3J0KTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogU2V0cyB0aGUgY3VycmVudCB0cmFuc3BvcnQuIERpc2FibGVzIHRoZSBleGlzdGluZyBvbmUgKGlmIGFueSkuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHNldFRyYW5zcG9ydCh0cmFuc3BvcnQpIHtcbiAgICAgICAgaWYgKHRoaXMudHJhbnNwb3J0KSB7XG4gICAgICAgICAgICB0aGlzLnRyYW5zcG9ydC5yZW1vdmVBbGxMaXN0ZW5lcnMoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBzZXQgdXAgdHJhbnNwb3J0XG4gICAgICAgIHRoaXMudHJhbnNwb3J0ID0gdHJhbnNwb3J0O1xuICAgICAgICAvLyBzZXQgdXAgdHJhbnNwb3J0IGxpc3RlbmVyc1xuICAgICAgICB0cmFuc3BvcnRcbiAgICAgICAgICAgIC5vbihcImRyYWluXCIsIHRoaXMub25EcmFpbi5iaW5kKHRoaXMpKVxuICAgICAgICAgICAgLm9uKFwicGFja2V0XCIsIHRoaXMub25QYWNrZXQuYmluZCh0aGlzKSlcbiAgICAgICAgICAgIC5vbihcImVycm9yXCIsIHRoaXMub25FcnJvci5iaW5kKHRoaXMpKVxuICAgICAgICAgICAgLm9uKFwiY2xvc2VcIiwgKHJlYXNvbikgPT4gdGhpcy5vbkNsb3NlKFwidHJhbnNwb3J0IGNsb3NlXCIsIHJlYXNvbikpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBQcm9iZXMgYSB0cmFuc3BvcnQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gbmFtZSAtIHRyYW5zcG9ydCBuYW1lXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBwcm9iZShuYW1lKSB7XG4gICAgICAgIGxldCB0cmFuc3BvcnQgPSB0aGlzLmNyZWF0ZVRyYW5zcG9ydChuYW1lKTtcbiAgICAgICAgbGV0IGZhaWxlZCA9IGZhbHNlO1xuICAgICAgICBTb2NrZXQucHJpb3JXZWJzb2NrZXRTdWNjZXNzID0gZmFsc2U7XG4gICAgICAgIGNvbnN0IG9uVHJhbnNwb3J0T3BlbiA9ICgpID0+IHtcbiAgICAgICAgICAgIGlmIChmYWlsZWQpXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgdHJhbnNwb3J0LnNlbmQoW3sgdHlwZTogXCJwaW5nXCIsIGRhdGE6IFwicHJvYmVcIiB9XSk7XG4gICAgICAgICAgICB0cmFuc3BvcnQub25jZShcInBhY2tldFwiLCAobXNnKSA9PiB7XG4gICAgICAgICAgICAgICAgaWYgKGZhaWxlZClcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIGlmIChcInBvbmdcIiA9PT0gbXNnLnR5cGUgJiYgXCJwcm9iZVwiID09PSBtc2cuZGF0YSkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLnVwZ3JhZGluZyA9IHRydWU7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwidXBncmFkaW5nXCIsIHRyYW5zcG9ydCk7XG4gICAgICAgICAgICAgICAgICAgIGlmICghdHJhbnNwb3J0KVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICBTb2NrZXQucHJpb3JXZWJzb2NrZXRTdWNjZXNzID0gXCJ3ZWJzb2NrZXRcIiA9PT0gdHJhbnNwb3J0Lm5hbWU7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMudHJhbnNwb3J0LnBhdXNlKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChmYWlsZWQpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKFwiY2xvc2VkXCIgPT09IHRoaXMucmVhZHlTdGF0ZSlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgICAgICAgICBjbGVhbnVwKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLnNldFRyYW5zcG9ydCh0cmFuc3BvcnQpO1xuICAgICAgICAgICAgICAgICAgICAgICAgdHJhbnNwb3J0LnNlbmQoW3sgdHlwZTogXCJ1cGdyYWRlXCIgfV0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJ1cGdyYWRlXCIsIHRyYW5zcG9ydCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB0cmFuc3BvcnQgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy51cGdyYWRpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZmx1c2goKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IoXCJwcm9iZSBlcnJvclwiKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgICAgICAgICBlcnIudHJhbnNwb3J0ID0gdHJhbnNwb3J0Lm5hbWU7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwidXBncmFkZUVycm9yXCIsIGVycik7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH07XG4gICAgICAgIGZ1bmN0aW9uIGZyZWV6ZVRyYW5zcG9ydCgpIHtcbiAgICAgICAgICAgIGlmIChmYWlsZWQpXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgLy8gQW55IGNhbGxiYWNrIGNhbGxlZCBieSB0cmFuc3BvcnQgc2hvdWxkIGJlIGlnbm9yZWQgc2luY2Ugbm93XG4gICAgICAgICAgICBmYWlsZWQgPSB0cnVlO1xuICAgICAgICAgICAgY2xlYW51cCgpO1xuICAgICAgICAgICAgdHJhbnNwb3J0LmNsb3NlKCk7XG4gICAgICAgICAgICB0cmFuc3BvcnQgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIC8vIEhhbmRsZSBhbnkgZXJyb3IgdGhhdCBoYXBwZW5zIHdoaWxlIHByb2JpbmdcbiAgICAgICAgY29uc3Qgb25lcnJvciA9IChlcnIpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGVycm9yID0gbmV3IEVycm9yKFwicHJvYmUgZXJyb3I6IFwiICsgZXJyKTtcbiAgICAgICAgICAgIC8vIEB0cy1pZ25vcmVcbiAgICAgICAgICAgIGVycm9yLnRyYW5zcG9ydCA9IHRyYW5zcG9ydC5uYW1lO1xuICAgICAgICAgICAgZnJlZXplVHJhbnNwb3J0KCk7XG4gICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInVwZ3JhZGVFcnJvclwiLCBlcnJvcik7XG4gICAgICAgIH07XG4gICAgICAgIGZ1bmN0aW9uIG9uVHJhbnNwb3J0Q2xvc2UoKSB7XG4gICAgICAgICAgICBvbmVycm9yKFwidHJhbnNwb3J0IGNsb3NlZFwiKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBXaGVuIHRoZSBzb2NrZXQgaXMgY2xvc2VkIHdoaWxlIHdlJ3JlIHByb2JpbmdcbiAgICAgICAgZnVuY3Rpb24gb25jbG9zZSgpIHtcbiAgICAgICAgICAgIG9uZXJyb3IoXCJzb2NrZXQgY2xvc2VkXCIpO1xuICAgICAgICB9XG4gICAgICAgIC8vIFdoZW4gdGhlIHNvY2tldCBpcyB1cGdyYWRlZCB3aGlsZSB3ZSdyZSBwcm9iaW5nXG4gICAgICAgIGZ1bmN0aW9uIG9udXBncmFkZSh0bykge1xuICAgICAgICAgICAgaWYgKHRyYW5zcG9ydCAmJiB0by5uYW1lICE9PSB0cmFuc3BvcnQubmFtZSkge1xuICAgICAgICAgICAgICAgIGZyZWV6ZVRyYW5zcG9ydCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIC8vIFJlbW92ZSBhbGwgbGlzdGVuZXJzIG9uIHRoZSB0cmFuc3BvcnQgYW5kIG9uIHNlbGZcbiAgICAgICAgY29uc3QgY2xlYW51cCA9ICgpID0+IHtcbiAgICAgICAgICAgIHRyYW5zcG9ydC5yZW1vdmVMaXN0ZW5lcihcIm9wZW5cIiwgb25UcmFuc3BvcnRPcGVuKTtcbiAgICAgICAgICAgIHRyYW5zcG9ydC5yZW1vdmVMaXN0ZW5lcihcImVycm9yXCIsIG9uZXJyb3IpO1xuICAgICAgICAgICAgdHJhbnNwb3J0LnJlbW92ZUxpc3RlbmVyKFwiY2xvc2VcIiwgb25UcmFuc3BvcnRDbG9zZSk7XG4gICAgICAgICAgICB0aGlzLm9mZihcImNsb3NlXCIsIG9uY2xvc2UpO1xuICAgICAgICAgICAgdGhpcy5vZmYoXCJ1cGdyYWRpbmdcIiwgb251cGdyYWRlKTtcbiAgICAgICAgfTtcbiAgICAgICAgdHJhbnNwb3J0Lm9uY2UoXCJvcGVuXCIsIG9uVHJhbnNwb3J0T3Blbik7XG4gICAgICAgIHRyYW5zcG9ydC5vbmNlKFwiZXJyb3JcIiwgb25lcnJvcik7XG4gICAgICAgIHRyYW5zcG9ydC5vbmNlKFwiY2xvc2VcIiwgb25UcmFuc3BvcnRDbG9zZSk7XG4gICAgICAgIHRoaXMub25jZShcImNsb3NlXCIsIG9uY2xvc2UpO1xuICAgICAgICB0aGlzLm9uY2UoXCJ1cGdyYWRpbmdcIiwgb251cGdyYWRlKTtcbiAgICAgICAgaWYgKHRoaXMudXBncmFkZXMuaW5kZXhPZihcIndlYnRyYW5zcG9ydFwiKSAhPT0gLTEgJiZcbiAgICAgICAgICAgIG5hbWUgIT09IFwid2VidHJhbnNwb3J0XCIpIHtcbiAgICAgICAgICAgIC8vIGZhdm9yIFdlYlRyYW5zcG9ydFxuICAgICAgICAgICAgdGhpcy5zZXRUaW1lb3V0Rm4oKCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmICghZmFpbGVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRyYW5zcG9ydC5vcGVuKCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSwgMjAwKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRyYW5zcG9ydC5vcGVuKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHdoZW4gY29ubmVjdGlvbiBpcyBkZWVtZWQgb3Blbi5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgb25PcGVuKCkge1xuICAgICAgICB0aGlzLnJlYWR5U3RhdGUgPSBcIm9wZW5cIjtcbiAgICAgICAgU29ja2V0LnByaW9yV2Vic29ja2V0U3VjY2VzcyA9IFwid2Vic29ja2V0XCIgPT09IHRoaXMudHJhbnNwb3J0Lm5hbWU7XG4gICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwib3BlblwiKTtcbiAgICAgICAgdGhpcy5mbHVzaCgpO1xuICAgICAgICAvLyB3ZSBjaGVjayBmb3IgYHJlYWR5U3RhdGVgIGluIGNhc2UgYW4gYG9wZW5gXG4gICAgICAgIC8vIGxpc3RlbmVyIGFscmVhZHkgY2xvc2VkIHRoZSBzb2NrZXRcbiAgICAgICAgaWYgKFwib3BlblwiID09PSB0aGlzLnJlYWR5U3RhdGUgJiYgdGhpcy5vcHRzLnVwZ3JhZGUpIHtcbiAgICAgICAgICAgIGxldCBpID0gMDtcbiAgICAgICAgICAgIGNvbnN0IGwgPSB0aGlzLnVwZ3JhZGVzLmxlbmd0aDtcbiAgICAgICAgICAgIGZvciAoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5wcm9iZSh0aGlzLnVwZ3JhZGVzW2ldKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBIYW5kbGVzIGEgcGFja2V0LlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvblBhY2tldChwYWNrZXQpIHtcbiAgICAgICAgaWYgKFwib3BlbmluZ1wiID09PSB0aGlzLnJlYWR5U3RhdGUgfHxcbiAgICAgICAgICAgIFwib3BlblwiID09PSB0aGlzLnJlYWR5U3RhdGUgfHxcbiAgICAgICAgICAgIFwiY2xvc2luZ1wiID09PSB0aGlzLnJlYWR5U3RhdGUpIHtcbiAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwicGFja2V0XCIsIHBhY2tldCk7XG4gICAgICAgICAgICAvLyBTb2NrZXQgaXMgbGl2ZSAtIGFueSBwYWNrZXQgY291bnRzXG4gICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcImhlYXJ0YmVhdFwiKTtcbiAgICAgICAgICAgIHRoaXMucmVzZXRQaW5nVGltZW91dCgpO1xuICAgICAgICAgICAgc3dpdGNoIChwYWNrZXQudHlwZSkge1xuICAgICAgICAgICAgICAgIGNhc2UgXCJvcGVuXCI6XG4gICAgICAgICAgICAgICAgICAgIHRoaXMub25IYW5kc2hha2UoSlNPTi5wYXJzZShwYWNrZXQuZGF0YSkpO1xuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgICAgICBjYXNlIFwicGluZ1wiOlxuICAgICAgICAgICAgICAgICAgICB0aGlzLnNlbmRQYWNrZXQoXCJwb25nXCIpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInBpbmdcIik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwicG9uZ1wiKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSBcImVycm9yXCI6XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGVyciA9IG5ldyBFcnJvcihcInNlcnZlciBlcnJvclwiKTtcbiAgICAgICAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgICAgICAgICBlcnIuY29kZSA9IHBhY2tldC5kYXRhO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLm9uRXJyb3IoZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgY2FzZSBcIm1lc3NhZ2VcIjpcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJkYXRhXCIsIHBhY2tldC5kYXRhKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJtZXNzYWdlXCIsIHBhY2tldC5kYXRhKTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHVwb24gaGFuZHNoYWtlIGNvbXBsZXRpb24uXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gZGF0YSAtIGhhbmRzaGFrZSBvYmpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9uSGFuZHNoYWtlKGRhdGEpIHtcbiAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJoYW5kc2hha2VcIiwgZGF0YSk7XG4gICAgICAgIHRoaXMuaWQgPSBkYXRhLnNpZDtcbiAgICAgICAgdGhpcy50cmFuc3BvcnQucXVlcnkuc2lkID0gZGF0YS5zaWQ7XG4gICAgICAgIHRoaXMudXBncmFkZXMgPSB0aGlzLmZpbHRlclVwZ3JhZGVzKGRhdGEudXBncmFkZXMpO1xuICAgICAgICB0aGlzLnBpbmdJbnRlcnZhbCA9IGRhdGEucGluZ0ludGVydmFsO1xuICAgICAgICB0aGlzLnBpbmdUaW1lb3V0ID0gZGF0YS5waW5nVGltZW91dDtcbiAgICAgICAgdGhpcy5tYXhQYXlsb2FkID0gZGF0YS5tYXhQYXlsb2FkO1xuICAgICAgICB0aGlzLm9uT3BlbigpO1xuICAgICAgICAvLyBJbiBjYXNlIG9wZW4gaGFuZGxlciBjbG9zZXMgc29ja2V0XG4gICAgICAgIGlmIChcImNsb3NlZFwiID09PSB0aGlzLnJlYWR5U3RhdGUpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIHRoaXMucmVzZXRQaW5nVGltZW91dCgpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTZXRzIGFuZCByZXNldHMgcGluZyB0aW1lb3V0IHRpbWVyIGJhc2VkIG9uIHNlcnZlciBwaW5ncy5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgcmVzZXRQaW5nVGltZW91dCgpIHtcbiAgICAgICAgdGhpcy5jbGVhclRpbWVvdXRGbih0aGlzLnBpbmdUaW1lb3V0VGltZXIpO1xuICAgICAgICB0aGlzLnBpbmdUaW1lb3V0VGltZXIgPSB0aGlzLnNldFRpbWVvdXRGbigoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLm9uQ2xvc2UoXCJwaW5nIHRpbWVvdXRcIik7XG4gICAgICAgIH0sIHRoaXMucGluZ0ludGVydmFsICsgdGhpcy5waW5nVGltZW91dCk7XG4gICAgICAgIGlmICh0aGlzLm9wdHMuYXV0b1VucmVmKSB7XG4gICAgICAgICAgICB0aGlzLnBpbmdUaW1lb3V0VGltZXIudW5yZWYoKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgb24gYGRyYWluYCBldmVudFxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbkRyYWluKCkge1xuICAgICAgICB0aGlzLndyaXRlQnVmZmVyLnNwbGljZSgwLCB0aGlzLnByZXZCdWZmZXJMZW4pO1xuICAgICAgICAvLyBzZXR0aW5nIHByZXZCdWZmZXJMZW4gPSAwIGlzIHZlcnkgaW1wb3J0YW50XG4gICAgICAgIC8vIGZvciBleGFtcGxlLCB3aGVuIHVwZ3JhZGluZywgdXBncmFkZSBwYWNrZXQgaXMgc2VudCBvdmVyLFxuICAgICAgICAvLyBhbmQgYSBub256ZXJvIHByZXZCdWZmZXJMZW4gY291bGQgY2F1c2UgcHJvYmxlbXMgb24gYGRyYWluYFxuICAgICAgICB0aGlzLnByZXZCdWZmZXJMZW4gPSAwO1xuICAgICAgICBpZiAoMCA9PT0gdGhpcy53cml0ZUJ1ZmZlci5sZW5ndGgpIHtcbiAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwiZHJhaW5cIik7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmZsdXNoKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogRmx1c2ggd3JpdGUgYnVmZmVycy5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgZmx1c2goKSB7XG4gICAgICAgIGlmIChcImNsb3NlZFwiICE9PSB0aGlzLnJlYWR5U3RhdGUgJiZcbiAgICAgICAgICAgIHRoaXMudHJhbnNwb3J0LndyaXRhYmxlICYmXG4gICAgICAgICAgICAhdGhpcy51cGdyYWRpbmcgJiZcbiAgICAgICAgICAgIHRoaXMud3JpdGVCdWZmZXIubGVuZ3RoKSB7XG4gICAgICAgICAgICBjb25zdCBwYWNrZXRzID0gdGhpcy5nZXRXcml0YWJsZVBhY2tldHMoKTtcbiAgICAgICAgICAgIHRoaXMudHJhbnNwb3J0LnNlbmQocGFja2V0cyk7XG4gICAgICAgICAgICAvLyBrZWVwIHRyYWNrIG9mIGN1cnJlbnQgbGVuZ3RoIG9mIHdyaXRlQnVmZmVyXG4gICAgICAgICAgICAvLyBzcGxpY2Ugd3JpdGVCdWZmZXIgYW5kIGNhbGxiYWNrQnVmZmVyIG9uIGBkcmFpbmBcbiAgICAgICAgICAgIHRoaXMucHJldkJ1ZmZlckxlbiA9IHBhY2tldHMubGVuZ3RoO1xuICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJmbHVzaFwiKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBFbnN1cmUgdGhlIGVuY29kZWQgc2l6ZSBvZiB0aGUgd3JpdGVCdWZmZXIgaXMgYmVsb3cgdGhlIG1heFBheWxvYWQgdmFsdWUgc2VudCBieSB0aGUgc2VydmVyIChvbmx5IGZvciBIVFRQXG4gICAgICogbG9uZy1wb2xsaW5nKVxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBnZXRXcml0YWJsZVBhY2tldHMoKSB7XG4gICAgICAgIGNvbnN0IHNob3VsZENoZWNrUGF5bG9hZFNpemUgPSB0aGlzLm1heFBheWxvYWQgJiZcbiAgICAgICAgICAgIHRoaXMudHJhbnNwb3J0Lm5hbWUgPT09IFwicG9sbGluZ1wiICYmXG4gICAgICAgICAgICB0aGlzLndyaXRlQnVmZmVyLmxlbmd0aCA+IDE7XG4gICAgICAgIGlmICghc2hvdWxkQ2hlY2tQYXlsb2FkU2l6ZSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMud3JpdGVCdWZmZXI7XG4gICAgICAgIH1cbiAgICAgICAgbGV0IHBheWxvYWRTaXplID0gMTsgLy8gZmlyc3QgcGFja2V0IHR5cGVcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLndyaXRlQnVmZmVyLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBjb25zdCBkYXRhID0gdGhpcy53cml0ZUJ1ZmZlcltpXS5kYXRhO1xuICAgICAgICAgICAgaWYgKGRhdGEpIHtcbiAgICAgICAgICAgICAgICBwYXlsb2FkU2l6ZSArPSBieXRlTGVuZ3RoKGRhdGEpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGkgPiAwICYmIHBheWxvYWRTaXplID4gdGhpcy5tYXhQYXlsb2FkKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMud3JpdGVCdWZmZXIuc2xpY2UoMCwgaSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYXlsb2FkU2l6ZSArPSAyOyAvLyBzZXBhcmF0b3IgKyBwYWNrZXQgdHlwZVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLndyaXRlQnVmZmVyO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTZW5kcyBhIG1lc3NhZ2UuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gbXNnIC0gbWVzc2FnZS5cbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucy5cbiAgICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFjayBmdW5jdGlvbi5cbiAgICAgKiBAcmV0dXJuIHtTb2NrZXR9IGZvciBjaGFpbmluZy5cbiAgICAgKi9cbiAgICB3cml0ZShtc2csIG9wdGlvbnMsIGZuKSB7XG4gICAgICAgIHRoaXMuc2VuZFBhY2tldChcIm1lc3NhZ2VcIiwgbXNnLCBvcHRpb25zLCBmbik7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICBzZW5kKG1zZywgb3B0aW9ucywgZm4pIHtcbiAgICAgICAgdGhpcy5zZW5kUGFja2V0KFwibWVzc2FnZVwiLCBtc2csIG9wdGlvbnMsIGZuKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNlbmRzIGEgcGFja2V0LlxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IHR5cGU6IHBhY2tldCB0eXBlLlxuICAgICAqIEBwYXJhbSB7U3RyaW5nfSBkYXRhLlxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zLlxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIC0gY2FsbGJhY2sgZnVuY3Rpb24uXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBzZW5kUGFja2V0KHR5cGUsIGRhdGEsIG9wdGlvbnMsIGZuKSB7XG4gICAgICAgIGlmIChcImZ1bmN0aW9uXCIgPT09IHR5cGVvZiBkYXRhKSB7XG4gICAgICAgICAgICBmbiA9IGRhdGE7XG4gICAgICAgICAgICBkYXRhID0gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIGlmIChcImZ1bmN0aW9uXCIgPT09IHR5cGVvZiBvcHRpb25zKSB7XG4gICAgICAgICAgICBmbiA9IG9wdGlvbnM7XG4gICAgICAgICAgICBvcHRpb25zID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoXCJjbG9zaW5nXCIgPT09IHRoaXMucmVhZHlTdGF0ZSB8fCBcImNsb3NlZFwiID09PSB0aGlzLnJlYWR5U3RhdGUpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgICAgICAgb3B0aW9ucy5jb21wcmVzcyA9IGZhbHNlICE9PSBvcHRpb25zLmNvbXByZXNzO1xuICAgICAgICBjb25zdCBwYWNrZXQgPSB7XG4gICAgICAgICAgICB0eXBlOiB0eXBlLFxuICAgICAgICAgICAgZGF0YTogZGF0YSxcbiAgICAgICAgICAgIG9wdGlvbnM6IG9wdGlvbnMsXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwicGFja2V0Q3JlYXRlXCIsIHBhY2tldCk7XG4gICAgICAgIHRoaXMud3JpdGVCdWZmZXIucHVzaChwYWNrZXQpO1xuICAgICAgICBpZiAoZm4pXG4gICAgICAgICAgICB0aGlzLm9uY2UoXCJmbHVzaFwiLCBmbik7XG4gICAgICAgIHRoaXMuZmx1c2goKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2xvc2VzIHRoZSBjb25uZWN0aW9uLlxuICAgICAqL1xuICAgIGNsb3NlKCkge1xuICAgICAgICBjb25zdCBjbG9zZSA9ICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMub25DbG9zZShcImZvcmNlZCBjbG9zZVwiKTtcbiAgICAgICAgICAgIHRoaXMudHJhbnNwb3J0LmNsb3NlKCk7XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IGNsZWFudXBBbmRDbG9zZSA9ICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMub2ZmKFwidXBncmFkZVwiLCBjbGVhbnVwQW5kQ2xvc2UpO1xuICAgICAgICAgICAgdGhpcy5vZmYoXCJ1cGdyYWRlRXJyb3JcIiwgY2xlYW51cEFuZENsb3NlKTtcbiAgICAgICAgICAgIGNsb3NlKCk7XG4gICAgICAgIH07XG4gICAgICAgIGNvbnN0IHdhaXRGb3JVcGdyYWRlID0gKCkgPT4ge1xuICAgICAgICAgICAgLy8gd2FpdCBmb3IgdXBncmFkZSB0byBmaW5pc2ggc2luY2Ugd2UgY2FuJ3Qgc2VuZCBwYWNrZXRzIHdoaWxlIHBhdXNpbmcgYSB0cmFuc3BvcnRcbiAgICAgICAgICAgIHRoaXMub25jZShcInVwZ3JhZGVcIiwgY2xlYW51cEFuZENsb3NlKTtcbiAgICAgICAgICAgIHRoaXMub25jZShcInVwZ3JhZGVFcnJvclwiLCBjbGVhbnVwQW5kQ2xvc2UpO1xuICAgICAgICB9O1xuICAgICAgICBpZiAoXCJvcGVuaW5nXCIgPT09IHRoaXMucmVhZHlTdGF0ZSB8fCBcIm9wZW5cIiA9PT0gdGhpcy5yZWFkeVN0YXRlKSB7XG4gICAgICAgICAgICB0aGlzLnJlYWR5U3RhdGUgPSBcImNsb3NpbmdcIjtcbiAgICAgICAgICAgIGlmICh0aGlzLndyaXRlQnVmZmVyLmxlbmd0aCkge1xuICAgICAgICAgICAgICAgIHRoaXMub25jZShcImRyYWluXCIsICgpID0+IHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKHRoaXMudXBncmFkaW5nKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB3YWl0Rm9yVXBncmFkZSgpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgY2xvc2UoKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAodGhpcy51cGdyYWRpbmcpIHtcbiAgICAgICAgICAgICAgICB3YWl0Rm9yVXBncmFkZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgY2xvc2UoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHVwb24gdHJhbnNwb3J0IGVycm9yXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9uRXJyb3IoZXJyKSB7XG4gICAgICAgIFNvY2tldC5wcmlvcldlYnNvY2tldFN1Y2Nlc3MgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJlcnJvclwiLCBlcnIpO1xuICAgICAgICB0aGlzLm9uQ2xvc2UoXCJ0cmFuc3BvcnQgZXJyb3JcIiwgZXJyKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHVwb24gdHJhbnNwb3J0IGNsb3NlLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbkNsb3NlKHJlYXNvbiwgZGVzY3JpcHRpb24pIHtcbiAgICAgICAgaWYgKFwib3BlbmluZ1wiID09PSB0aGlzLnJlYWR5U3RhdGUgfHxcbiAgICAgICAgICAgIFwib3BlblwiID09PSB0aGlzLnJlYWR5U3RhdGUgfHxcbiAgICAgICAgICAgIFwiY2xvc2luZ1wiID09PSB0aGlzLnJlYWR5U3RhdGUpIHtcbiAgICAgICAgICAgIC8vIGNsZWFyIHRpbWVyc1xuICAgICAgICAgICAgdGhpcy5jbGVhclRpbWVvdXRGbih0aGlzLnBpbmdUaW1lb3V0VGltZXIpO1xuICAgICAgICAgICAgLy8gc3RvcCBldmVudCBmcm9tIGZpcmluZyBhZ2FpbiBmb3IgdHJhbnNwb3J0XG4gICAgICAgICAgICB0aGlzLnRyYW5zcG9ydC5yZW1vdmVBbGxMaXN0ZW5lcnMoXCJjbG9zZVwiKTtcbiAgICAgICAgICAgIC8vIGVuc3VyZSB0cmFuc3BvcnQgd29uJ3Qgc3RheSBvcGVuXG4gICAgICAgICAgICB0aGlzLnRyYW5zcG9ydC5jbG9zZSgpO1xuICAgICAgICAgICAgLy8gaWdub3JlIGZ1cnRoZXIgdHJhbnNwb3J0IGNvbW11bmljYXRpb25cbiAgICAgICAgICAgIHRoaXMudHJhbnNwb3J0LnJlbW92ZUFsbExpc3RlbmVycygpO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiByZW1vdmVFdmVudExpc3RlbmVyID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgICAgICByZW1vdmVFdmVudExpc3RlbmVyKFwiYmVmb3JldW5sb2FkXCIsIHRoaXMuYmVmb3JldW5sb2FkRXZlbnRMaXN0ZW5lciwgZmFsc2UpO1xuICAgICAgICAgICAgICAgIHJlbW92ZUV2ZW50TGlzdGVuZXIoXCJvZmZsaW5lXCIsIHRoaXMub2ZmbGluZUV2ZW50TGlzdGVuZXIsIGZhbHNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIHNldCByZWFkeSBzdGF0ZVxuICAgICAgICAgICAgdGhpcy5yZWFkeVN0YXRlID0gXCJjbG9zZWRcIjtcbiAgICAgICAgICAgIC8vIGNsZWFyIHNlc3Npb24gaWRcbiAgICAgICAgICAgIHRoaXMuaWQgPSBudWxsO1xuICAgICAgICAgICAgLy8gZW1pdCBjbG9zZSBldmVudFxuICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJjbG9zZVwiLCByZWFzb24sIGRlc2NyaXB0aW9uKTtcbiAgICAgICAgICAgIC8vIGNsZWFuIGJ1ZmZlcnMgYWZ0ZXIsIHNvIHVzZXJzIGNhbiBzdGlsbFxuICAgICAgICAgICAgLy8gZ3JhYiB0aGUgYnVmZmVycyBvbiBgY2xvc2VgIGV2ZW50XG4gICAgICAgICAgICB0aGlzLndyaXRlQnVmZmVyID0gW107XG4gICAgICAgICAgICB0aGlzLnByZXZCdWZmZXJMZW4gPSAwO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEZpbHRlcnMgdXBncmFkZXMsIHJldHVybmluZyBvbmx5IHRob3NlIG1hdGNoaW5nIGNsaWVudCB0cmFuc3BvcnRzLlxuICAgICAqXG4gICAgICogQHBhcmFtIHtBcnJheX0gdXBncmFkZXMgLSBzZXJ2ZXIgdXBncmFkZXNcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIGZpbHRlclVwZ3JhZGVzKHVwZ3JhZGVzKSB7XG4gICAgICAgIGNvbnN0IGZpbHRlcmVkVXBncmFkZXMgPSBbXTtcbiAgICAgICAgbGV0IGkgPSAwO1xuICAgICAgICBjb25zdCBqID0gdXBncmFkZXMubGVuZ3RoO1xuICAgICAgICBmb3IgKDsgaSA8IGo7IGkrKykge1xuICAgICAgICAgICAgaWYgKH50aGlzLnRyYW5zcG9ydHMuaW5kZXhPZih1cGdyYWRlc1tpXSkpXG4gICAgICAgICAgICAgICAgZmlsdGVyZWRVcGdyYWRlcy5wdXNoKHVwZ3JhZGVzW2ldKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmlsdGVyZWRVcGdyYWRlcztcbiAgICB9XG59XG5Tb2NrZXQucHJvdG9jb2wgPSBwcm90b2NvbDtcbiIsImltcG9ydCB7IHBhcnNlIH0gZnJvbSBcImVuZ2luZS5pby1jbGllbnRcIjtcbi8qKlxuICogVVJMIHBhcnNlci5cbiAqXG4gKiBAcGFyYW0gdXJpIC0gdXJsXG4gKiBAcGFyYW0gcGF0aCAtIHRoZSByZXF1ZXN0IHBhdGggb2YgdGhlIGNvbm5lY3Rpb25cbiAqIEBwYXJhbSBsb2MgLSBBbiBvYmplY3QgbWVhbnQgdG8gbWltaWMgd2luZG93LmxvY2F0aW9uLlxuICogICAgICAgIERlZmF1bHRzIHRvIHdpbmRvdy5sb2NhdGlvbi5cbiAqIEBwdWJsaWNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVybCh1cmksIHBhdGggPSBcIlwiLCBsb2MpIHtcbiAgICBsZXQgb2JqID0gdXJpO1xuICAgIC8vIGRlZmF1bHQgdG8gd2luZG93LmxvY2F0aW9uXG4gICAgbG9jID0gbG9jIHx8ICh0eXBlb2YgbG9jYXRpb24gIT09IFwidW5kZWZpbmVkXCIgJiYgbG9jYXRpb24pO1xuICAgIGlmIChudWxsID09IHVyaSlcbiAgICAgICAgdXJpID0gbG9jLnByb3RvY29sICsgXCIvL1wiICsgbG9jLmhvc3Q7XG4gICAgLy8gcmVsYXRpdmUgcGF0aCBzdXBwb3J0XG4gICAgaWYgKHR5cGVvZiB1cmkgPT09IFwic3RyaW5nXCIpIHtcbiAgICAgICAgaWYgKFwiL1wiID09PSB1cmkuY2hhckF0KDApKSB7XG4gICAgICAgICAgICBpZiAoXCIvXCIgPT09IHVyaS5jaGFyQXQoMSkpIHtcbiAgICAgICAgICAgICAgICB1cmkgPSBsb2MucHJvdG9jb2wgKyB1cmk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICB1cmkgPSBsb2MuaG9zdCArIHVyaTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAoIS9eKGh0dHBzP3x3c3M/KTpcXC9cXC8vLnRlc3QodXJpKSkge1xuICAgICAgICAgICAgaWYgKFwidW5kZWZpbmVkXCIgIT09IHR5cGVvZiBsb2MpIHtcbiAgICAgICAgICAgICAgICB1cmkgPSBsb2MucHJvdG9jb2wgKyBcIi8vXCIgKyB1cmk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICB1cmkgPSBcImh0dHBzOi8vXCIgKyB1cmk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgLy8gcGFyc2VcbiAgICAgICAgb2JqID0gcGFyc2UodXJpKTtcbiAgICB9XG4gICAgLy8gbWFrZSBzdXJlIHdlIHRyZWF0IGBsb2NhbGhvc3Q6ODBgIGFuZCBgbG9jYWxob3N0YCBlcXVhbGx5XG4gICAgaWYgKCFvYmoucG9ydCkge1xuICAgICAgICBpZiAoL14oaHR0cHx3cykkLy50ZXN0KG9iai5wcm90b2NvbCkpIHtcbiAgICAgICAgICAgIG9iai5wb3J0ID0gXCI4MFwiO1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKC9eKGh0dHB8d3MpcyQvLnRlc3Qob2JqLnByb3RvY29sKSkge1xuICAgICAgICAgICAgb2JqLnBvcnQgPSBcIjQ0M1wiO1xuICAgICAgICB9XG4gICAgfVxuICAgIG9iai5wYXRoID0gb2JqLnBhdGggfHwgXCIvXCI7XG4gICAgY29uc3QgaXB2NiA9IG9iai5ob3N0LmluZGV4T2YoXCI6XCIpICE9PSAtMTtcbiAgICBjb25zdCBob3N0ID0gaXB2NiA/IFwiW1wiICsgb2JqLmhvc3QgKyBcIl1cIiA6IG9iai5ob3N0O1xuICAgIC8vIGRlZmluZSB1bmlxdWUgaWRcbiAgICBvYmouaWQgPSBvYmoucHJvdG9jb2wgKyBcIjovL1wiICsgaG9zdCArIFwiOlwiICsgb2JqLnBvcnQgKyBwYXRoO1xuICAgIC8vIGRlZmluZSBocmVmXG4gICAgb2JqLmhyZWYgPVxuICAgICAgICBvYmoucHJvdG9jb2wgK1xuICAgICAgICAgICAgXCI6Ly9cIiArXG4gICAgICAgICAgICBob3N0ICtcbiAgICAgICAgICAgIChsb2MgJiYgbG9jLnBvcnQgPT09IG9iai5wb3J0ID8gXCJcIiA6IFwiOlwiICsgb2JqLnBvcnQpO1xuICAgIHJldHVybiBvYmo7XG59XG4iLCJjb25zdCB3aXRoTmF0aXZlQXJyYXlCdWZmZXIgPSB0eXBlb2YgQXJyYXlCdWZmZXIgPT09IFwiZnVuY3Rpb25cIjtcbmNvbnN0IGlzVmlldyA9IChvYmopID0+IHtcbiAgICByZXR1cm4gdHlwZW9mIEFycmF5QnVmZmVyLmlzVmlldyA9PT0gXCJmdW5jdGlvblwiXG4gICAgICAgID8gQXJyYXlCdWZmZXIuaXNWaWV3KG9iailcbiAgICAgICAgOiBvYmouYnVmZmVyIGluc3RhbmNlb2YgQXJyYXlCdWZmZXI7XG59O1xuY29uc3QgdG9TdHJpbmcgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nO1xuY29uc3Qgd2l0aE5hdGl2ZUJsb2IgPSB0eXBlb2YgQmxvYiA9PT0gXCJmdW5jdGlvblwiIHx8XG4gICAgKHR5cGVvZiBCbG9iICE9PSBcInVuZGVmaW5lZFwiICYmXG4gICAgICAgIHRvU3RyaW5nLmNhbGwoQmxvYikgPT09IFwiW29iamVjdCBCbG9iQ29uc3RydWN0b3JdXCIpO1xuY29uc3Qgd2l0aE5hdGl2ZUZpbGUgPSB0eXBlb2YgRmlsZSA9PT0gXCJmdW5jdGlvblwiIHx8XG4gICAgKHR5cGVvZiBGaWxlICE9PSBcInVuZGVmaW5lZFwiICYmXG4gICAgICAgIHRvU3RyaW5nLmNhbGwoRmlsZSkgPT09IFwiW29iamVjdCBGaWxlQ29uc3RydWN0b3JdXCIpO1xuLyoqXG4gKiBSZXR1cm5zIHRydWUgaWYgb2JqIGlzIGEgQnVmZmVyLCBhbiBBcnJheUJ1ZmZlciwgYSBCbG9iIG9yIGEgRmlsZS5cbiAqXG4gKiBAcHJpdmF0ZVxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNCaW5hcnkob2JqKSB7XG4gICAgcmV0dXJuICgod2l0aE5hdGl2ZUFycmF5QnVmZmVyICYmIChvYmogaW5zdGFuY2VvZiBBcnJheUJ1ZmZlciB8fCBpc1ZpZXcob2JqKSkpIHx8XG4gICAgICAgICh3aXRoTmF0aXZlQmxvYiAmJiBvYmogaW5zdGFuY2VvZiBCbG9iKSB8fFxuICAgICAgICAod2l0aE5hdGl2ZUZpbGUgJiYgb2JqIGluc3RhbmNlb2YgRmlsZSkpO1xufVxuZXhwb3J0IGZ1bmN0aW9uIGhhc0JpbmFyeShvYmosIHRvSlNPTikge1xuICAgIGlmICghb2JqIHx8IHR5cGVvZiBvYmogIT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBpZiAoQXJyYXkuaXNBcnJheShvYmopKSB7XG4gICAgICAgIGZvciAobGV0IGkgPSAwLCBsID0gb2JqLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICAgICAgaWYgKGhhc0JpbmFyeShvYmpbaV0pKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBpZiAoaXNCaW5hcnkob2JqKSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgaWYgKG9iai50b0pTT04gJiZcbiAgICAgICAgdHlwZW9mIG9iai50b0pTT04gPT09IFwiZnVuY3Rpb25cIiAmJlxuICAgICAgICBhcmd1bWVudHMubGVuZ3RoID09PSAxKSB7XG4gICAgICAgIHJldHVybiBoYXNCaW5hcnkob2JqLnRvSlNPTigpLCB0cnVlKTtcbiAgICB9XG4gICAgZm9yIChjb25zdCBrZXkgaW4gb2JqKSB7XG4gICAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwob2JqLCBrZXkpICYmIGhhc0JpbmFyeShvYmpba2V5XSkpIHtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbn1cbiIsImltcG9ydCB7IGlzQmluYXJ5IH0gZnJvbSBcIi4vaXMtYmluYXJ5LmpzXCI7XG4vKipcbiAqIFJlcGxhY2VzIGV2ZXJ5IEJ1ZmZlciB8IEFycmF5QnVmZmVyIHwgQmxvYiB8IEZpbGUgaW4gcGFja2V0IHdpdGggYSBudW1iZXJlZCBwbGFjZWhvbGRlci5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gcGFja2V0IC0gc29ja2V0LmlvIGV2ZW50IHBhY2tldFxuICogQHJldHVybiB7T2JqZWN0fSB3aXRoIGRlY29uc3RydWN0ZWQgcGFja2V0IGFuZCBsaXN0IG9mIGJ1ZmZlcnNcbiAqIEBwdWJsaWNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlY29uc3RydWN0UGFja2V0KHBhY2tldCkge1xuICAgIGNvbnN0IGJ1ZmZlcnMgPSBbXTtcbiAgICBjb25zdCBwYWNrZXREYXRhID0gcGFja2V0LmRhdGE7XG4gICAgY29uc3QgcGFjayA9IHBhY2tldDtcbiAgICBwYWNrLmRhdGEgPSBfZGVjb25zdHJ1Y3RQYWNrZXQocGFja2V0RGF0YSwgYnVmZmVycyk7XG4gICAgcGFjay5hdHRhY2htZW50cyA9IGJ1ZmZlcnMubGVuZ3RoOyAvLyBudW1iZXIgb2YgYmluYXJ5ICdhdHRhY2htZW50cydcbiAgICByZXR1cm4geyBwYWNrZXQ6IHBhY2ssIGJ1ZmZlcnM6IGJ1ZmZlcnMgfTtcbn1cbmZ1bmN0aW9uIF9kZWNvbnN0cnVjdFBhY2tldChkYXRhLCBidWZmZXJzKSB7XG4gICAgaWYgKCFkYXRhKVxuICAgICAgICByZXR1cm4gZGF0YTtcbiAgICBpZiAoaXNCaW5hcnkoZGF0YSkpIHtcbiAgICAgICAgY29uc3QgcGxhY2Vob2xkZXIgPSB7IF9wbGFjZWhvbGRlcjogdHJ1ZSwgbnVtOiBidWZmZXJzLmxlbmd0aCB9O1xuICAgICAgICBidWZmZXJzLnB1c2goZGF0YSk7XG4gICAgICAgIHJldHVybiBwbGFjZWhvbGRlcjtcbiAgICB9XG4gICAgZWxzZSBpZiAoQXJyYXkuaXNBcnJheShkYXRhKSkge1xuICAgICAgICBjb25zdCBuZXdEYXRhID0gbmV3IEFycmF5KGRhdGEubGVuZ3RoKTtcbiAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBkYXRhLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBuZXdEYXRhW2ldID0gX2RlY29uc3RydWN0UGFja2V0KGRhdGFbaV0sIGJ1ZmZlcnMpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXdEYXRhO1xuICAgIH1cbiAgICBlbHNlIGlmICh0eXBlb2YgZGF0YSA9PT0gXCJvYmplY3RcIiAmJiAhKGRhdGEgaW5zdGFuY2VvZiBEYXRlKSkge1xuICAgICAgICBjb25zdCBuZXdEYXRhID0ge307XG4gICAgICAgIGZvciAoY29uc3Qga2V5IGluIGRhdGEpIHtcbiAgICAgICAgICAgIGlmIChPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoZGF0YSwga2V5KSkge1xuICAgICAgICAgICAgICAgIG5ld0RhdGFba2V5XSA9IF9kZWNvbnN0cnVjdFBhY2tldChkYXRhW2tleV0sIGJ1ZmZlcnMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBuZXdEYXRhO1xuICAgIH1cbiAgICByZXR1cm4gZGF0YTtcbn1cbi8qKlxuICogUmVjb25zdHJ1Y3RzIGEgYmluYXJ5IHBhY2tldCBmcm9tIGl0cyBwbGFjZWhvbGRlciBwYWNrZXQgYW5kIGJ1ZmZlcnNcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gcGFja2V0IC0gZXZlbnQgcGFja2V0IHdpdGggcGxhY2Vob2xkZXJzXG4gKiBAcGFyYW0ge0FycmF5fSBidWZmZXJzIC0gYmluYXJ5IGJ1ZmZlcnMgdG8gcHV0IGluIHBsYWNlaG9sZGVyIHBvc2l0aW9uc1xuICogQHJldHVybiB7T2JqZWN0fSByZWNvbnN0cnVjdGVkIHBhY2tldFxuICogQHB1YmxpY1xuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb25zdHJ1Y3RQYWNrZXQocGFja2V0LCBidWZmZXJzKSB7XG4gICAgcGFja2V0LmRhdGEgPSBfcmVjb25zdHJ1Y3RQYWNrZXQocGFja2V0LmRhdGEsIGJ1ZmZlcnMpO1xuICAgIGRlbGV0ZSBwYWNrZXQuYXR0YWNobWVudHM7IC8vIG5vIGxvbmdlciB1c2VmdWxcbiAgICByZXR1cm4gcGFja2V0O1xufVxuZnVuY3Rpb24gX3JlY29uc3RydWN0UGFja2V0KGRhdGEsIGJ1ZmZlcnMpIHtcbiAgICBpZiAoIWRhdGEpXG4gICAgICAgIHJldHVybiBkYXRhO1xuICAgIGlmIChkYXRhICYmIGRhdGEuX3BsYWNlaG9sZGVyID09PSB0cnVlKSB7XG4gICAgICAgIGNvbnN0IGlzSW5kZXhWYWxpZCA9IHR5cGVvZiBkYXRhLm51bSA9PT0gXCJudW1iZXJcIiAmJlxuICAgICAgICAgICAgZGF0YS5udW0gPj0gMCAmJlxuICAgICAgICAgICAgZGF0YS5udW0gPCBidWZmZXJzLmxlbmd0aDtcbiAgICAgICAgaWYgKGlzSW5kZXhWYWxpZCkge1xuICAgICAgICAgICAgcmV0dXJuIGJ1ZmZlcnNbZGF0YS5udW1dOyAvLyBhcHByb3ByaWF0ZSBidWZmZXIgKHNob3VsZCBiZSBuYXR1cmFsIG9yZGVyIGFueXdheSlcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImlsbGVnYWwgYXR0YWNobWVudHNcIik7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZWxzZSBpZiAoQXJyYXkuaXNBcnJheShkYXRhKSkge1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGRhdGEubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgIGRhdGFbaV0gPSBfcmVjb25zdHJ1Y3RQYWNrZXQoZGF0YVtpXSwgYnVmZmVycyk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgZWxzZSBpZiAodHlwZW9mIGRhdGEgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgZm9yIChjb25zdCBrZXkgaW4gZGF0YSkge1xuICAgICAgICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChkYXRhLCBrZXkpKSB7XG4gICAgICAgICAgICAgICAgZGF0YVtrZXldID0gX3JlY29uc3RydWN0UGFja2V0KGRhdGFba2V5XSwgYnVmZmVycyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIGRhdGE7XG59XG4iLCJpbXBvcnQgeyBFbWl0dGVyIH0gZnJvbSBcIkBzb2NrZXQuaW8vY29tcG9uZW50LWVtaXR0ZXJcIjtcbmltcG9ydCB7IGRlY29uc3RydWN0UGFja2V0LCByZWNvbnN0cnVjdFBhY2tldCB9IGZyb20gXCIuL2JpbmFyeS5qc1wiO1xuaW1wb3J0IHsgaXNCaW5hcnksIGhhc0JpbmFyeSB9IGZyb20gXCIuL2lzLWJpbmFyeS5qc1wiO1xuLyoqXG4gKiBUaGVzZSBzdHJpbmdzIG11c3Qgbm90IGJlIHVzZWQgYXMgZXZlbnQgbmFtZXMsIGFzIHRoZXkgaGF2ZSBhIHNwZWNpYWwgbWVhbmluZy5cbiAqL1xuY29uc3QgUkVTRVJWRURfRVZFTlRTID0gW1xuICAgIFwiY29ubmVjdFwiLFxuICAgIFwiY29ubmVjdF9lcnJvclwiLFxuICAgIFwiZGlzY29ubmVjdFwiLFxuICAgIFwiZGlzY29ubmVjdGluZ1wiLFxuICAgIFwibmV3TGlzdGVuZXJcIixcbiAgICBcInJlbW92ZUxpc3RlbmVyXCIsIC8vIHVzZWQgYnkgdGhlIE5vZGUuanMgRXZlbnRFbWl0dGVyXG5dO1xuLyoqXG4gKiBQcm90b2NvbCB2ZXJzaW9uLlxuICpcbiAqIEBwdWJsaWNcbiAqL1xuZXhwb3J0IGNvbnN0IHByb3RvY29sID0gNTtcbmV4cG9ydCB2YXIgUGFja2V0VHlwZTtcbihmdW5jdGlvbiAoUGFja2V0VHlwZSkge1xuICAgIFBhY2tldFR5cGVbUGFja2V0VHlwZVtcIkNPTk5FQ1RcIl0gPSAwXSA9IFwiQ09OTkVDVFwiO1xuICAgIFBhY2tldFR5cGVbUGFja2V0VHlwZVtcIkRJU0NPTk5FQ1RcIl0gPSAxXSA9IFwiRElTQ09OTkVDVFwiO1xuICAgIFBhY2tldFR5cGVbUGFja2V0VHlwZVtcIkVWRU5UXCJdID0gMl0gPSBcIkVWRU5UXCI7XG4gICAgUGFja2V0VHlwZVtQYWNrZXRUeXBlW1wiQUNLXCJdID0gM10gPSBcIkFDS1wiO1xuICAgIFBhY2tldFR5cGVbUGFja2V0VHlwZVtcIkNPTk5FQ1RfRVJST1JcIl0gPSA0XSA9IFwiQ09OTkVDVF9FUlJPUlwiO1xuICAgIFBhY2tldFR5cGVbUGFja2V0VHlwZVtcIkJJTkFSWV9FVkVOVFwiXSA9IDVdID0gXCJCSU5BUllfRVZFTlRcIjtcbiAgICBQYWNrZXRUeXBlW1BhY2tldFR5cGVbXCJCSU5BUllfQUNLXCJdID0gNl0gPSBcIkJJTkFSWV9BQ0tcIjtcbn0pKFBhY2tldFR5cGUgfHwgKFBhY2tldFR5cGUgPSB7fSkpO1xuLyoqXG4gKiBBIHNvY2tldC5pbyBFbmNvZGVyIGluc3RhbmNlXG4gKi9cbmV4cG9ydCBjbGFzcyBFbmNvZGVyIHtcbiAgICAvKipcbiAgICAgKiBFbmNvZGVyIGNvbnN0cnVjdG9yXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge2Z1bmN0aW9ufSByZXBsYWNlciAtIGN1c3RvbSByZXBsYWNlciB0byBwYXNzIGRvd24gdG8gSlNPTi5wYXJzZVxuICAgICAqL1xuICAgIGNvbnN0cnVjdG9yKHJlcGxhY2VyKSB7XG4gICAgICAgIHRoaXMucmVwbGFjZXIgPSByZXBsYWNlcjtcbiAgICB9XG4gICAgLyoqXG4gICAgICogRW5jb2RlIGEgcGFja2V0IGFzIGEgc2luZ2xlIHN0cmluZyBpZiBub24tYmluYXJ5LCBvciBhcyBhXG4gICAgICogYnVmZmVyIHNlcXVlbmNlLCBkZXBlbmRpbmcgb24gcGFja2V0IHR5cGUuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb2JqIC0gcGFja2V0IG9iamVjdFxuICAgICAqL1xuICAgIGVuY29kZShvYmopIHtcbiAgICAgICAgaWYgKG9iai50eXBlID09PSBQYWNrZXRUeXBlLkVWRU5UIHx8IG9iai50eXBlID09PSBQYWNrZXRUeXBlLkFDSykge1xuICAgICAgICAgICAgaWYgKGhhc0JpbmFyeShvYmopKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuZW5jb2RlQXNCaW5hcnkoe1xuICAgICAgICAgICAgICAgICAgICB0eXBlOiBvYmoudHlwZSA9PT0gUGFja2V0VHlwZS5FVkVOVFxuICAgICAgICAgICAgICAgICAgICAgICAgPyBQYWNrZXRUeXBlLkJJTkFSWV9FVkVOVFxuICAgICAgICAgICAgICAgICAgICAgICAgOiBQYWNrZXRUeXBlLkJJTkFSWV9BQ0ssXG4gICAgICAgICAgICAgICAgICAgIG5zcDogb2JqLm5zcCxcbiAgICAgICAgICAgICAgICAgICAgZGF0YTogb2JqLmRhdGEsXG4gICAgICAgICAgICAgICAgICAgIGlkOiBvYmouaWQsXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFt0aGlzLmVuY29kZUFzU3RyaW5nKG9iaildO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBFbmNvZGUgcGFja2V0IGFzIHN0cmluZy5cbiAgICAgKi9cbiAgICBlbmNvZGVBc1N0cmluZyhvYmopIHtcbiAgICAgICAgLy8gZmlyc3QgaXMgdHlwZVxuICAgICAgICBsZXQgc3RyID0gXCJcIiArIG9iai50eXBlO1xuICAgICAgICAvLyBhdHRhY2htZW50cyBpZiB3ZSBoYXZlIHRoZW1cbiAgICAgICAgaWYgKG9iai50eXBlID09PSBQYWNrZXRUeXBlLkJJTkFSWV9FVkVOVCB8fFxuICAgICAgICAgICAgb2JqLnR5cGUgPT09IFBhY2tldFR5cGUuQklOQVJZX0FDSykge1xuICAgICAgICAgICAgc3RyICs9IG9iai5hdHRhY2htZW50cyArIFwiLVwiO1xuICAgICAgICB9XG4gICAgICAgIC8vIGlmIHdlIGhhdmUgYSBuYW1lc3BhY2Ugb3RoZXIgdGhhbiBgL2BcbiAgICAgICAgLy8gd2UgYXBwZW5kIGl0IGZvbGxvd2VkIGJ5IGEgY29tbWEgYCxgXG4gICAgICAgIGlmIChvYmoubnNwICYmIFwiL1wiICE9PSBvYmoubnNwKSB7XG4gICAgICAgICAgICBzdHIgKz0gb2JqLm5zcCArIFwiLFwiO1xuICAgICAgICB9XG4gICAgICAgIC8vIGltbWVkaWF0ZWx5IGZvbGxvd2VkIGJ5IHRoZSBpZFxuICAgICAgICBpZiAobnVsbCAhPSBvYmouaWQpIHtcbiAgICAgICAgICAgIHN0ciArPSBvYmouaWQ7XG4gICAgICAgIH1cbiAgICAgICAgLy8ganNvbiBkYXRhXG4gICAgICAgIGlmIChudWxsICE9IG9iai5kYXRhKSB7XG4gICAgICAgICAgICBzdHIgKz0gSlNPTi5zdHJpbmdpZnkob2JqLmRhdGEsIHRoaXMucmVwbGFjZXIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzdHI7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEVuY29kZSBwYWNrZXQgYXMgJ2J1ZmZlciBzZXF1ZW5jZScgYnkgcmVtb3ZpbmcgYmxvYnMsIGFuZFxuICAgICAqIGRlY29uc3RydWN0aW5nIHBhY2tldCBpbnRvIG9iamVjdCB3aXRoIHBsYWNlaG9sZGVycyBhbmRcbiAgICAgKiBhIGxpc3Qgb2YgYnVmZmVycy5cbiAgICAgKi9cbiAgICBlbmNvZGVBc0JpbmFyeShvYmopIHtcbiAgICAgICAgY29uc3QgZGVjb25zdHJ1Y3Rpb24gPSBkZWNvbnN0cnVjdFBhY2tldChvYmopO1xuICAgICAgICBjb25zdCBwYWNrID0gdGhpcy5lbmNvZGVBc1N0cmluZyhkZWNvbnN0cnVjdGlvbi5wYWNrZXQpO1xuICAgICAgICBjb25zdCBidWZmZXJzID0gZGVjb25zdHJ1Y3Rpb24uYnVmZmVycztcbiAgICAgICAgYnVmZmVycy51bnNoaWZ0KHBhY2spOyAvLyBhZGQgcGFja2V0IGluZm8gdG8gYmVnaW5uaW5nIG9mIGRhdGEgbGlzdFxuICAgICAgICByZXR1cm4gYnVmZmVyczsgLy8gd3JpdGUgYWxsIHRoZSBidWZmZXJzXG4gICAgfVxufVxuLy8gc2VlIGh0dHBzOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzg1MTEyODEvY2hlY2staWYtYS12YWx1ZS1pcy1hbi1vYmplY3QtaW4tamF2YXNjcmlwdFxuZnVuY3Rpb24gaXNPYmplY3QodmFsdWUpIHtcbiAgICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHZhbHVlKSA9PT0gXCJbb2JqZWN0IE9iamVjdF1cIjtcbn1cbi8qKlxuICogQSBzb2NrZXQuaW8gRGVjb2RlciBpbnN0YW5jZVxuICpcbiAqIEByZXR1cm4ge09iamVjdH0gZGVjb2RlclxuICovXG5leHBvcnQgY2xhc3MgRGVjb2RlciBleHRlbmRzIEVtaXR0ZXIge1xuICAgIC8qKlxuICAgICAqIERlY29kZXIgY29uc3RydWN0b3JcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7ZnVuY3Rpb259IHJldml2ZXIgLSBjdXN0b20gcmV2aXZlciB0byBwYXNzIGRvd24gdG8gSlNPTi5zdHJpbmdpZnlcbiAgICAgKi9cbiAgICBjb25zdHJ1Y3RvcihyZXZpdmVyKSB7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMucmV2aXZlciA9IHJldml2ZXI7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIERlY29kZXMgYW4gZW5jb2RlZCBwYWNrZXQgc3RyaW5nIGludG8gcGFja2V0IEpTT04uXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge1N0cmluZ30gb2JqIC0gZW5jb2RlZCBwYWNrZXRcbiAgICAgKi9cbiAgICBhZGQob2JqKSB7XG4gICAgICAgIGxldCBwYWNrZXQ7XG4gICAgICAgIGlmICh0eXBlb2Ygb2JqID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgICBpZiAodGhpcy5yZWNvbnN0cnVjdG9yKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZ290IHBsYWludGV4dCBkYXRhIHdoZW4gcmVjb25zdHJ1Y3RpbmcgYSBwYWNrZXRcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYWNrZXQgPSB0aGlzLmRlY29kZVN0cmluZyhvYmopO1xuICAgICAgICAgICAgY29uc3QgaXNCaW5hcnlFdmVudCA9IHBhY2tldC50eXBlID09PSBQYWNrZXRUeXBlLkJJTkFSWV9FVkVOVDtcbiAgICAgICAgICAgIGlmIChpc0JpbmFyeUV2ZW50IHx8IHBhY2tldC50eXBlID09PSBQYWNrZXRUeXBlLkJJTkFSWV9BQ0spIHtcbiAgICAgICAgICAgICAgICBwYWNrZXQudHlwZSA9IGlzQmluYXJ5RXZlbnQgPyBQYWNrZXRUeXBlLkVWRU5UIDogUGFja2V0VHlwZS5BQ0s7XG4gICAgICAgICAgICAgICAgLy8gYmluYXJ5IHBhY2tldCdzIGpzb25cbiAgICAgICAgICAgICAgICB0aGlzLnJlY29uc3RydWN0b3IgPSBuZXcgQmluYXJ5UmVjb25zdHJ1Y3RvcihwYWNrZXQpO1xuICAgICAgICAgICAgICAgIC8vIG5vIGF0dGFjaG1lbnRzLCBsYWJlbGVkIGJpbmFyeSBidXQgbm8gYmluYXJ5IGRhdGEgdG8gZm9sbG93XG4gICAgICAgICAgICAgICAgaWYgKHBhY2tldC5hdHRhY2htZW50cyA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICBzdXBlci5lbWl0UmVzZXJ2ZWQoXCJkZWNvZGVkXCIsIHBhY2tldCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gbm9uLWJpbmFyeSBmdWxsIHBhY2tldFxuICAgICAgICAgICAgICAgIHN1cGVyLmVtaXRSZXNlcnZlZChcImRlY29kZWRcIiwgcGFja2V0KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChpc0JpbmFyeShvYmopIHx8IG9iai5iYXNlNjQpIHtcbiAgICAgICAgICAgIC8vIHJhdyBiaW5hcnkgZGF0YVxuICAgICAgICAgICAgaWYgKCF0aGlzLnJlY29uc3RydWN0b3IpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJnb3QgYmluYXJ5IGRhdGEgd2hlbiBub3QgcmVjb25zdHJ1Y3RpbmcgYSBwYWNrZXRcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICBwYWNrZXQgPSB0aGlzLnJlY29uc3RydWN0b3IudGFrZUJpbmFyeURhdGEob2JqKTtcbiAgICAgICAgICAgICAgICBpZiAocGFja2V0KSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIHJlY2VpdmVkIGZpbmFsIGJ1ZmZlclxuICAgICAgICAgICAgICAgICAgICB0aGlzLnJlY29uc3RydWN0b3IgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICBzdXBlci5lbWl0UmVzZXJ2ZWQoXCJkZWNvZGVkXCIsIHBhY2tldCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiVW5rbm93biB0eXBlOiBcIiArIG9iaik7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogRGVjb2RlIGEgcGFja2V0IFN0cmluZyAoSlNPTiBkYXRhKVxuICAgICAqXG4gICAgICogQHBhcmFtIHtTdHJpbmd9IHN0clxuICAgICAqIEByZXR1cm4ge09iamVjdH0gcGFja2V0XG4gICAgICovXG4gICAgZGVjb2RlU3RyaW5nKHN0cikge1xuICAgICAgICBsZXQgaSA9IDA7XG4gICAgICAgIC8vIGxvb2sgdXAgdHlwZVxuICAgICAgICBjb25zdCBwID0ge1xuICAgICAgICAgICAgdHlwZTogTnVtYmVyKHN0ci5jaGFyQXQoMCkpLFxuICAgICAgICB9O1xuICAgICAgICBpZiAoUGFja2V0VHlwZVtwLnR5cGVdID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInVua25vd24gcGFja2V0IHR5cGUgXCIgKyBwLnR5cGUpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGxvb2sgdXAgYXR0YWNobWVudHMgaWYgdHlwZSBiaW5hcnlcbiAgICAgICAgaWYgKHAudHlwZSA9PT0gUGFja2V0VHlwZS5CSU5BUllfRVZFTlQgfHxcbiAgICAgICAgICAgIHAudHlwZSA9PT0gUGFja2V0VHlwZS5CSU5BUllfQUNLKSB7XG4gICAgICAgICAgICBjb25zdCBzdGFydCA9IGkgKyAxO1xuICAgICAgICAgICAgd2hpbGUgKHN0ci5jaGFyQXQoKytpKSAhPT0gXCItXCIgJiYgaSAhPSBzdHIubGVuZ3RoKSB7IH1cbiAgICAgICAgICAgIGNvbnN0IGJ1ZiA9IHN0ci5zdWJzdHJpbmcoc3RhcnQsIGkpO1xuICAgICAgICAgICAgaWYgKGJ1ZiAhPSBOdW1iZXIoYnVmKSB8fCBzdHIuY2hhckF0KGkpICE9PSBcIi1cIikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIklsbGVnYWwgYXR0YWNobWVudHNcIik7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwLmF0dGFjaG1lbnRzID0gTnVtYmVyKGJ1Zik7XG4gICAgICAgIH1cbiAgICAgICAgLy8gbG9vayB1cCBuYW1lc3BhY2UgKGlmIGFueSlcbiAgICAgICAgaWYgKFwiL1wiID09PSBzdHIuY2hhckF0KGkgKyAxKSkge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBpICsgMTtcbiAgICAgICAgICAgIHdoaWxlICgrK2kpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBjID0gc3RyLmNoYXJBdChpKTtcbiAgICAgICAgICAgICAgICBpZiAoXCIsXCIgPT09IGMpXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgICAgIGlmIChpID09PSBzdHIubGVuZ3RoKVxuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHAubnNwID0gc3RyLnN1YnN0cmluZyhzdGFydCwgaSk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBwLm5zcCA9IFwiL1wiO1xuICAgICAgICB9XG4gICAgICAgIC8vIGxvb2sgdXAgaWRcbiAgICAgICAgY29uc3QgbmV4dCA9IHN0ci5jaGFyQXQoaSArIDEpO1xuICAgICAgICBpZiAoXCJcIiAhPT0gbmV4dCAmJiBOdW1iZXIobmV4dCkgPT0gbmV4dCkge1xuICAgICAgICAgICAgY29uc3Qgc3RhcnQgPSBpICsgMTtcbiAgICAgICAgICAgIHdoaWxlICgrK2kpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBjID0gc3RyLmNoYXJBdChpKTtcbiAgICAgICAgICAgICAgICBpZiAobnVsbCA9PSBjIHx8IE51bWJlcihjKSAhPSBjKSB7XG4gICAgICAgICAgICAgICAgICAgIC0taTtcbiAgICAgICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmIChpID09PSBzdHIubGVuZ3RoKVxuICAgICAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHAuaWQgPSBOdW1iZXIoc3RyLnN1YnN0cmluZyhzdGFydCwgaSArIDEpKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBsb29rIHVwIGpzb24gZGF0YVxuICAgICAgICBpZiAoc3RyLmNoYXJBdCgrK2kpKSB7XG4gICAgICAgICAgICBjb25zdCBwYXlsb2FkID0gdGhpcy50cnlQYXJzZShzdHIuc3Vic3RyKGkpKTtcbiAgICAgICAgICAgIGlmIChEZWNvZGVyLmlzUGF5bG9hZFZhbGlkKHAudHlwZSwgcGF5bG9hZCkpIHtcbiAgICAgICAgICAgICAgICBwLmRhdGEgPSBwYXlsb2FkO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaW52YWxpZCBwYXlsb2FkXCIpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwO1xuICAgIH1cbiAgICB0cnlQYXJzZShzdHIpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIHJldHVybiBKU09OLnBhcnNlKHN0ciwgdGhpcy5yZXZpdmVyKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgfVxuICAgIHN0YXRpYyBpc1BheWxvYWRWYWxpZCh0eXBlLCBwYXlsb2FkKSB7XG4gICAgICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgICAgICAgY2FzZSBQYWNrZXRUeXBlLkNPTk5FQ1Q6XG4gICAgICAgICAgICAgICAgcmV0dXJuIGlzT2JqZWN0KHBheWxvYWQpO1xuICAgICAgICAgICAgY2FzZSBQYWNrZXRUeXBlLkRJU0NPTk5FQ1Q6XG4gICAgICAgICAgICAgICAgcmV0dXJuIHBheWxvYWQgPT09IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIGNhc2UgUGFja2V0VHlwZS5DT05ORUNUX0VSUk9SOlxuICAgICAgICAgICAgICAgIHJldHVybiB0eXBlb2YgcGF5bG9hZCA9PT0gXCJzdHJpbmdcIiB8fCBpc09iamVjdChwYXlsb2FkKTtcbiAgICAgICAgICAgIGNhc2UgUGFja2V0VHlwZS5FVkVOVDpcbiAgICAgICAgICAgIGNhc2UgUGFja2V0VHlwZS5CSU5BUllfRVZFTlQ6XG4gICAgICAgICAgICAgICAgcmV0dXJuIChBcnJheS5pc0FycmF5KHBheWxvYWQpICYmXG4gICAgICAgICAgICAgICAgICAgICh0eXBlb2YgcGF5bG9hZFswXSA9PT0gXCJudW1iZXJcIiB8fFxuICAgICAgICAgICAgICAgICAgICAgICAgKHR5cGVvZiBwYXlsb2FkWzBdID09PSBcInN0cmluZ1wiICYmXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgUkVTRVJWRURfRVZFTlRTLmluZGV4T2YocGF5bG9hZFswXSkgPT09IC0xKSkpO1xuICAgICAgICAgICAgY2FzZSBQYWNrZXRUeXBlLkFDSzpcbiAgICAgICAgICAgIGNhc2UgUGFja2V0VHlwZS5CSU5BUllfQUNLOlxuICAgICAgICAgICAgICAgIHJldHVybiBBcnJheS5pc0FycmF5KHBheWxvYWQpO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIERlYWxsb2NhdGVzIGEgcGFyc2VyJ3MgcmVzb3VyY2VzXG4gICAgICovXG4gICAgZGVzdHJveSgpIHtcbiAgICAgICAgaWYgKHRoaXMucmVjb25zdHJ1Y3Rvcikge1xuICAgICAgICAgICAgdGhpcy5yZWNvbnN0cnVjdG9yLmZpbmlzaGVkUmVjb25zdHJ1Y3Rpb24oKTtcbiAgICAgICAgICAgIHRoaXMucmVjb25zdHJ1Y3RvciA9IG51bGw7XG4gICAgICAgIH1cbiAgICB9XG59XG4vKipcbiAqIEEgbWFuYWdlciBvZiBhIGJpbmFyeSBldmVudCdzICdidWZmZXIgc2VxdWVuY2UnLiBTaG91bGRcbiAqIGJlIGNvbnN0cnVjdGVkIHdoZW5ldmVyIGEgcGFja2V0IG9mIHR5cGUgQklOQVJZX0VWRU5UIGlzXG4gKiBkZWNvZGVkLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBwYWNrZXRcbiAqIEByZXR1cm4ge0JpbmFyeVJlY29uc3RydWN0b3J9IGluaXRpYWxpemVkIHJlY29uc3RydWN0b3JcbiAqL1xuY2xhc3MgQmluYXJ5UmVjb25zdHJ1Y3RvciB7XG4gICAgY29uc3RydWN0b3IocGFja2V0KSB7XG4gICAgICAgIHRoaXMucGFja2V0ID0gcGFja2V0O1xuICAgICAgICB0aGlzLmJ1ZmZlcnMgPSBbXTtcbiAgICAgICAgdGhpcy5yZWNvblBhY2sgPSBwYWNrZXQ7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIE1ldGhvZCB0byBiZSBjYWxsZWQgd2hlbiBiaW5hcnkgZGF0YSByZWNlaXZlZCBmcm9tIGNvbm5lY3Rpb25cbiAgICAgKiBhZnRlciBhIEJJTkFSWV9FVkVOVCBwYWNrZXQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0ge0J1ZmZlciB8IEFycmF5QnVmZmVyfSBiaW5EYXRhIC0gdGhlIHJhdyBiaW5hcnkgZGF0YSByZWNlaXZlZFxuICAgICAqIEByZXR1cm4ge251bGwgfCBPYmplY3R9IHJldHVybnMgbnVsbCBpZiBtb3JlIGJpbmFyeSBkYXRhIGlzIGV4cGVjdGVkIG9yXG4gICAgICogICBhIHJlY29uc3RydWN0ZWQgcGFja2V0IG9iamVjdCBpZiBhbGwgYnVmZmVycyBoYXZlIGJlZW4gcmVjZWl2ZWQuXG4gICAgICovXG4gICAgdGFrZUJpbmFyeURhdGEoYmluRGF0YSkge1xuICAgICAgICB0aGlzLmJ1ZmZlcnMucHVzaChiaW5EYXRhKTtcbiAgICAgICAgaWYgKHRoaXMuYnVmZmVycy5sZW5ndGggPT09IHRoaXMucmVjb25QYWNrLmF0dGFjaG1lbnRzKSB7XG4gICAgICAgICAgICAvLyBkb25lIHdpdGggYnVmZmVyIGxpc3RcbiAgICAgICAgICAgIGNvbnN0IHBhY2tldCA9IHJlY29uc3RydWN0UGFja2V0KHRoaXMucmVjb25QYWNrLCB0aGlzLmJ1ZmZlcnMpO1xuICAgICAgICAgICAgdGhpcy5maW5pc2hlZFJlY29uc3RydWN0aW9uKCk7XG4gICAgICAgICAgICByZXR1cm4gcGFja2V0O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDbGVhbnMgdXAgYmluYXJ5IHBhY2tldCByZWNvbnN0cnVjdGlvbiB2YXJpYWJsZXMuXG4gICAgICovXG4gICAgZmluaXNoZWRSZWNvbnN0cnVjdGlvbigpIHtcbiAgICAgICAgdGhpcy5yZWNvblBhY2sgPSBudWxsO1xuICAgICAgICB0aGlzLmJ1ZmZlcnMgPSBbXTtcbiAgICB9XG59XG4iLCJleHBvcnQgZnVuY3Rpb24gb24ob2JqLCBldiwgZm4pIHtcbiAgICBvYmoub24oZXYsIGZuKTtcbiAgICByZXR1cm4gZnVuY3Rpb24gc3ViRGVzdHJveSgpIHtcbiAgICAgICAgb2JqLm9mZihldiwgZm4pO1xuICAgIH07XG59XG4iLCJpbXBvcnQgeyBQYWNrZXRUeXBlIH0gZnJvbSBcInNvY2tldC5pby1wYXJzZXJcIjtcbmltcG9ydCB7IG9uIH0gZnJvbSBcIi4vb24uanNcIjtcbmltcG9ydCB7IEVtaXR0ZXIsIH0gZnJvbSBcIkBzb2NrZXQuaW8vY29tcG9uZW50LWVtaXR0ZXJcIjtcbi8qKlxuICogSW50ZXJuYWwgZXZlbnRzLlxuICogVGhlc2UgZXZlbnRzIGNhbid0IGJlIGVtaXR0ZWQgYnkgdGhlIHVzZXIuXG4gKi9cbmNvbnN0IFJFU0VSVkVEX0VWRU5UUyA9IE9iamVjdC5mcmVlemUoe1xuICAgIGNvbm5lY3Q6IDEsXG4gICAgY29ubmVjdF9lcnJvcjogMSxcbiAgICBkaXNjb25uZWN0OiAxLFxuICAgIGRpc2Nvbm5lY3Rpbmc6IDEsXG4gICAgLy8gRXZlbnRFbWl0dGVyIHJlc2VydmVkIGV2ZW50czogaHR0cHM6Ly9ub2RlanMub3JnL2FwaS9ldmVudHMuaHRtbCNldmVudHNfZXZlbnRfbmV3bGlzdGVuZXJcbiAgICBuZXdMaXN0ZW5lcjogMSxcbiAgICByZW1vdmVMaXN0ZW5lcjogMSxcbn0pO1xuLyoqXG4gKiBBIFNvY2tldCBpcyB0aGUgZnVuZGFtZW50YWwgY2xhc3MgZm9yIGludGVyYWN0aW5nIHdpdGggdGhlIHNlcnZlci5cbiAqXG4gKiBBIFNvY2tldCBiZWxvbmdzIHRvIGEgY2VydGFpbiBOYW1lc3BhY2UgKGJ5IGRlZmF1bHQgLykgYW5kIHVzZXMgYW4gdW5kZXJseWluZyB7QGxpbmsgTWFuYWdlcn0gdG8gY29tbXVuaWNhdGUuXG4gKlxuICogQGV4YW1wbGVcbiAqIGNvbnN0IHNvY2tldCA9IGlvKCk7XG4gKlxuICogc29ja2V0Lm9uKFwiY29ubmVjdFwiLCAoKSA9PiB7XG4gKiAgIGNvbnNvbGUubG9nKFwiY29ubmVjdGVkXCIpO1xuICogfSk7XG4gKlxuICogLy8gc2VuZCBhbiBldmVudCB0byB0aGUgc2VydmVyXG4gKiBzb2NrZXQuZW1pdChcImZvb1wiLCBcImJhclwiKTtcbiAqXG4gKiBzb2NrZXQub24oXCJmb29iYXJcIiwgKCkgPT4ge1xuICogICAvLyBhbiBldmVudCB3YXMgcmVjZWl2ZWQgZnJvbSB0aGUgc2VydmVyXG4gKiB9KTtcbiAqXG4gKiAvLyB1cG9uIGRpc2Nvbm5lY3Rpb25cbiAqIHNvY2tldC5vbihcImRpc2Nvbm5lY3RcIiwgKHJlYXNvbikgPT4ge1xuICogICBjb25zb2xlLmxvZyhgZGlzY29ubmVjdGVkIGR1ZSB0byAke3JlYXNvbn1gKTtcbiAqIH0pO1xuICovXG5leHBvcnQgY2xhc3MgU29ja2V0IGV4dGVuZHMgRW1pdHRlciB7XG4gICAgLyoqXG4gICAgICogYFNvY2tldGAgY29uc3RydWN0b3IuXG4gICAgICovXG4gICAgY29uc3RydWN0b3IoaW8sIG5zcCwgb3B0cykge1xuICAgICAgICBzdXBlcigpO1xuICAgICAgICAvKipcbiAgICAgICAgICogV2hldGhlciB0aGUgc29ja2V0IGlzIGN1cnJlbnRseSBjb25uZWN0ZWQgdG8gdGhlIHNlcnZlci5cbiAgICAgICAgICpcbiAgICAgICAgICogQGV4YW1wbGVcbiAgICAgICAgICogY29uc3Qgc29ja2V0ID0gaW8oKTtcbiAgICAgICAgICpcbiAgICAgICAgICogc29ja2V0Lm9uKFwiY29ubmVjdFwiLCAoKSA9PiB7XG4gICAgICAgICAqICAgY29uc29sZS5sb2coc29ja2V0LmNvbm5lY3RlZCk7IC8vIHRydWVcbiAgICAgICAgICogfSk7XG4gICAgICAgICAqXG4gICAgICAgICAqIHNvY2tldC5vbihcImRpc2Nvbm5lY3RcIiwgKCkgPT4ge1xuICAgICAgICAgKiAgIGNvbnNvbGUubG9nKHNvY2tldC5jb25uZWN0ZWQpOyAvLyBmYWxzZVxuICAgICAgICAgKiB9KTtcbiAgICAgICAgICovXG4gICAgICAgIHRoaXMuY29ubmVjdGVkID0gZmFsc2U7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBXaGV0aGVyIHRoZSBjb25uZWN0aW9uIHN0YXRlIHdhcyByZWNvdmVyZWQgYWZ0ZXIgYSB0ZW1wb3JhcnkgZGlzY29ubmVjdGlvbi4gSW4gdGhhdCBjYXNlLCBhbnkgbWlzc2VkIHBhY2tldHMgd2lsbFxuICAgICAgICAgKiBiZSB0cmFuc21pdHRlZCBieSB0aGUgc2VydmVyLlxuICAgICAgICAgKi9cbiAgICAgICAgdGhpcy5yZWNvdmVyZWQgPSBmYWxzZTtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEJ1ZmZlciBmb3IgcGFja2V0cyByZWNlaXZlZCBiZWZvcmUgdGhlIENPTk5FQ1QgcGFja2V0XG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLnJlY2VpdmVCdWZmZXIgPSBbXTtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEJ1ZmZlciBmb3IgcGFja2V0cyB0aGF0IHdpbGwgYmUgc2VudCBvbmNlIHRoZSBzb2NrZXQgaXMgY29ubmVjdGVkXG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLnNlbmRCdWZmZXIgPSBbXTtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBxdWV1ZSBvZiBwYWNrZXRzIHRvIGJlIHNlbnQgd2l0aCByZXRyeSBpbiBjYXNlIG9mIGZhaWx1cmUuXG4gICAgICAgICAqXG4gICAgICAgICAqIFBhY2tldHMgYXJlIHNlbnQgb25lIGJ5IG9uZSwgZWFjaCB3YWl0aW5nIGZvciB0aGUgc2VydmVyIGFja25vd2xlZGdlbWVudCwgaW4gb3JkZXIgdG8gZ3VhcmFudGVlIHRoZSBkZWxpdmVyeSBvcmRlci5cbiAgICAgICAgICogQHByaXZhdGVcbiAgICAgICAgICovXG4gICAgICAgIHRoaXMuX3F1ZXVlID0gW107XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBBIHNlcXVlbmNlIHRvIGdlbmVyYXRlIHRoZSBJRCBvZiB0aGUge0BsaW5rIFF1ZXVlZFBhY2tldH0uXG4gICAgICAgICAqIEBwcml2YXRlXG4gICAgICAgICAqL1xuICAgICAgICB0aGlzLl9xdWV1ZVNlcSA9IDA7XG4gICAgICAgIHRoaXMuaWRzID0gMDtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEEgbWFwIGNvbnRhaW5pbmcgYWNrbm93bGVkZ2VtZW50IGhhbmRsZXJzLlxuICAgICAgICAgKlxuICAgICAgICAgKiBUaGUgYHdpdGhFcnJvcmAgYXR0cmlidXRlIGlzIHVzZWQgdG8gZGlmZmVyZW50aWF0ZSBoYW5kbGVycyB0aGF0IGFjY2VwdCBhbiBlcnJvciBhcyBmaXJzdCBhcmd1bWVudDpcbiAgICAgICAgICpcbiAgICAgICAgICogLSBgc29ja2V0LmVtaXQoXCJ0ZXN0XCIsIChlcnIsIHZhbHVlKSA9PiB7IC4uLiB9KWAgd2l0aCBgYWNrVGltZW91dGAgb3B0aW9uXG4gICAgICAgICAqIC0gYHNvY2tldC50aW1lb3V0KDUwMDApLmVtaXQoXCJ0ZXN0XCIsIChlcnIsIHZhbHVlKSA9PiB7IC4uLiB9KWBcbiAgICAgICAgICogLSBgY29uc3QgdmFsdWUgPSBhd2FpdCBzb2NrZXQuZW1pdFdpdGhBY2soXCJ0ZXN0XCIpYFxuICAgICAgICAgKlxuICAgICAgICAgKiBGcm9tIHRob3NlIHRoYXQgZG9uJ3Q6XG4gICAgICAgICAqXG4gICAgICAgICAqIC0gYHNvY2tldC5lbWl0KFwidGVzdFwiLCAodmFsdWUpID0+IHsgLi4uIH0pO2BcbiAgICAgICAgICpcbiAgICAgICAgICogSW4gdGhlIGZpcnN0IGNhc2UsIHRoZSBoYW5kbGVycyB3aWxsIGJlIGNhbGxlZCB3aXRoIGFuIGVycm9yIHdoZW46XG4gICAgICAgICAqXG4gICAgICAgICAqIC0gdGhlIHRpbWVvdXQgaXMgcmVhY2hlZFxuICAgICAgICAgKiAtIHRoZSBzb2NrZXQgZ2V0cyBkaXNjb25uZWN0ZWRcbiAgICAgICAgICpcbiAgICAgICAgICogSW4gdGhlIHNlY29uZCBjYXNlLCB0aGUgaGFuZGxlcnMgd2lsbCBiZSBzaW1wbHkgZGlzY2FyZGVkIHVwb24gZGlzY29ubmVjdGlvbiwgc2luY2UgdGhlIGNsaWVudCB3aWxsIG5ldmVyIHJlY2VpdmVcbiAgICAgICAgICogYW4gYWNrbm93bGVkZ2VtZW50IGZyb20gdGhlIHNlcnZlci5cbiAgICAgICAgICpcbiAgICAgICAgICogQHByaXZhdGVcbiAgICAgICAgICovXG4gICAgICAgIHRoaXMuYWNrcyA9IHt9O1xuICAgICAgICB0aGlzLmZsYWdzID0ge307XG4gICAgICAgIHRoaXMuaW8gPSBpbztcbiAgICAgICAgdGhpcy5uc3AgPSBuc3A7XG4gICAgICAgIGlmIChvcHRzICYmIG9wdHMuYXV0aCkge1xuICAgICAgICAgICAgdGhpcy5hdXRoID0gb3B0cy5hdXRoO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX29wdHMgPSBPYmplY3QuYXNzaWduKHt9LCBvcHRzKTtcbiAgICAgICAgaWYgKHRoaXMuaW8uX2F1dG9Db25uZWN0KVxuICAgICAgICAgICAgdGhpcy5vcGVuKCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFdoZXRoZXIgdGhlIHNvY2tldCBpcyBjdXJyZW50bHkgZGlzY29ubmVjdGVkXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGNvbnN0IHNvY2tldCA9IGlvKCk7XG4gICAgICpcbiAgICAgKiBzb2NrZXQub24oXCJjb25uZWN0XCIsICgpID0+IHtcbiAgICAgKiAgIGNvbnNvbGUubG9nKHNvY2tldC5kaXNjb25uZWN0ZWQpOyAvLyBmYWxzZVxuICAgICAqIH0pO1xuICAgICAqXG4gICAgICogc29ja2V0Lm9uKFwiZGlzY29ubmVjdFwiLCAoKSA9PiB7XG4gICAgICogICBjb25zb2xlLmxvZyhzb2NrZXQuZGlzY29ubmVjdGVkKTsgLy8gdHJ1ZVxuICAgICAqIH0pO1xuICAgICAqL1xuICAgIGdldCBkaXNjb25uZWN0ZWQoKSB7XG4gICAgICAgIHJldHVybiAhdGhpcy5jb25uZWN0ZWQ7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFN1YnNjcmliZSB0byBvcGVuLCBjbG9zZSBhbmQgcGFja2V0IGV2ZW50c1xuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBzdWJFdmVudHMoKSB7XG4gICAgICAgIGlmICh0aGlzLnN1YnMpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIGNvbnN0IGlvID0gdGhpcy5pbztcbiAgICAgICAgdGhpcy5zdWJzID0gW1xuICAgICAgICAgICAgb24oaW8sIFwib3BlblwiLCB0aGlzLm9ub3Blbi5iaW5kKHRoaXMpKSxcbiAgICAgICAgICAgIG9uKGlvLCBcInBhY2tldFwiLCB0aGlzLm9ucGFja2V0LmJpbmQodGhpcykpLFxuICAgICAgICAgICAgb24oaW8sIFwiZXJyb3JcIiwgdGhpcy5vbmVycm9yLmJpbmQodGhpcykpLFxuICAgICAgICAgICAgb24oaW8sIFwiY2xvc2VcIiwgdGhpcy5vbmNsb3NlLmJpbmQodGhpcykpLFxuICAgICAgICBdO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBXaGV0aGVyIHRoZSBTb2NrZXQgd2lsbCB0cnkgdG8gcmVjb25uZWN0IHdoZW4gaXRzIE1hbmFnZXIgY29ubmVjdHMgb3IgcmVjb25uZWN0cy5cbiAgICAgKlxuICAgICAqIEBleGFtcGxlXG4gICAgICogY29uc3Qgc29ja2V0ID0gaW8oKTtcbiAgICAgKlxuICAgICAqIGNvbnNvbGUubG9nKHNvY2tldC5hY3RpdmUpOyAvLyB0cnVlXG4gICAgICpcbiAgICAgKiBzb2NrZXQub24oXCJkaXNjb25uZWN0XCIsIChyZWFzb24pID0+IHtcbiAgICAgKiAgIGlmIChyZWFzb24gPT09IFwiaW8gc2VydmVyIGRpc2Nvbm5lY3RcIikge1xuICAgICAqICAgICAvLyB0aGUgZGlzY29ubmVjdGlvbiB3YXMgaW5pdGlhdGVkIGJ5IHRoZSBzZXJ2ZXIsIHlvdSBuZWVkIHRvIG1hbnVhbGx5IHJlY29ubmVjdFxuICAgICAqICAgICBjb25zb2xlLmxvZyhzb2NrZXQuYWN0aXZlKTsgLy8gZmFsc2VcbiAgICAgKiAgIH1cbiAgICAgKiAgIC8vIGVsc2UgdGhlIHNvY2tldCB3aWxsIGF1dG9tYXRpY2FsbHkgdHJ5IHRvIHJlY29ubmVjdFxuICAgICAqICAgY29uc29sZS5sb2coc29ja2V0LmFjdGl2ZSk7IC8vIHRydWVcbiAgICAgKiB9KTtcbiAgICAgKi9cbiAgICBnZXQgYWN0aXZlKCkge1xuICAgICAgICByZXR1cm4gISF0aGlzLnN1YnM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFwiT3BlbnNcIiB0aGUgc29ja2V0LlxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBjb25zdCBzb2NrZXQgPSBpbyh7XG4gICAgICogICBhdXRvQ29ubmVjdDogZmFsc2VcbiAgICAgKiB9KTtcbiAgICAgKlxuICAgICAqIHNvY2tldC5jb25uZWN0KCk7XG4gICAgICovXG4gICAgY29ubmVjdCgpIHtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKVxuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIHRoaXMuc3ViRXZlbnRzKCk7XG4gICAgICAgIGlmICghdGhpcy5pb1tcIl9yZWNvbm5lY3RpbmdcIl0pXG4gICAgICAgICAgICB0aGlzLmlvLm9wZW4oKTsgLy8gZW5zdXJlIG9wZW5cbiAgICAgICAgaWYgKFwib3BlblwiID09PSB0aGlzLmlvLl9yZWFkeVN0YXRlKVxuICAgICAgICAgICAgdGhpcy5vbm9wZW4oKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEFsaWFzIGZvciB7QGxpbmsgY29ubmVjdCgpfS5cbiAgICAgKi9cbiAgICBvcGVuKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5jb25uZWN0KCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNlbmRzIGEgYG1lc3NhZ2VgIGV2ZW50LlxuICAgICAqXG4gICAgICogVGhpcyBtZXRob2QgbWltaWNzIHRoZSBXZWJTb2NrZXQuc2VuZCgpIG1ldGhvZC5cbiAgICAgKlxuICAgICAqIEBzZWUgaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvQVBJL1dlYlNvY2tldC9zZW5kXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIHNvY2tldC5zZW5kKFwiaGVsbG9cIik7XG4gICAgICpcbiAgICAgKiAvLyB0aGlzIGlzIGVxdWl2YWxlbnQgdG9cbiAgICAgKiBzb2NrZXQuZW1pdChcIm1lc3NhZ2VcIiwgXCJoZWxsb1wiKTtcbiAgICAgKlxuICAgICAqIEByZXR1cm4gc2VsZlxuICAgICAqL1xuICAgIHNlbmQoLi4uYXJncykge1xuICAgICAgICBhcmdzLnVuc2hpZnQoXCJtZXNzYWdlXCIpO1xuICAgICAgICB0aGlzLmVtaXQuYXBwbHkodGhpcywgYXJncyk7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBPdmVycmlkZSBgZW1pdGAuXG4gICAgICogSWYgdGhlIGV2ZW50IGlzIGluIGBldmVudHNgLCBpdCdzIGVtaXR0ZWQgbm9ybWFsbHkuXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIHNvY2tldC5lbWl0KFwiaGVsbG9cIiwgXCJ3b3JsZFwiKTtcbiAgICAgKlxuICAgICAqIC8vIGFsbCBzZXJpYWxpemFibGUgZGF0YXN0cnVjdHVyZXMgYXJlIHN1cHBvcnRlZCAobm8gbmVlZCB0byBjYWxsIEpTT04uc3RyaW5naWZ5KVxuICAgICAqIHNvY2tldC5lbWl0KFwiaGVsbG9cIiwgMSwgXCIyXCIsIHsgMzogW1wiNFwiXSwgNTogVWludDhBcnJheS5mcm9tKFs2XSkgfSk7XG4gICAgICpcbiAgICAgKiAvLyB3aXRoIGFuIGFja25vd2xlZGdlbWVudCBmcm9tIHRoZSBzZXJ2ZXJcbiAgICAgKiBzb2NrZXQuZW1pdChcImhlbGxvXCIsIFwid29ybGRcIiwgKHZhbCkgPT4ge1xuICAgICAqICAgLy8gLi4uXG4gICAgICogfSk7XG4gICAgICpcbiAgICAgKiBAcmV0dXJuIHNlbGZcbiAgICAgKi9cbiAgICBlbWl0KGV2LCAuLi5hcmdzKSB7XG4gICAgICAgIGlmIChSRVNFUlZFRF9FVkVOVFMuaGFzT3duUHJvcGVydHkoZXYpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1wiJyArIGV2LnRvU3RyaW5nKCkgKyAnXCIgaXMgYSByZXNlcnZlZCBldmVudCBuYW1lJyk7XG4gICAgICAgIH1cbiAgICAgICAgYXJncy51bnNoaWZ0KGV2KTtcbiAgICAgICAgaWYgKHRoaXMuX29wdHMucmV0cmllcyAmJiAhdGhpcy5mbGFncy5mcm9tUXVldWUgJiYgIXRoaXMuZmxhZ3Mudm9sYXRpbGUpIHtcbiAgICAgICAgICAgIHRoaXMuX2FkZFRvUXVldWUoYXJncyk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwYWNrZXQgPSB7XG4gICAgICAgICAgICB0eXBlOiBQYWNrZXRUeXBlLkVWRU5ULFxuICAgICAgICAgICAgZGF0YTogYXJncyxcbiAgICAgICAgfTtcbiAgICAgICAgcGFja2V0Lm9wdGlvbnMgPSB7fTtcbiAgICAgICAgcGFja2V0Lm9wdGlvbnMuY29tcHJlc3MgPSB0aGlzLmZsYWdzLmNvbXByZXNzICE9PSBmYWxzZTtcbiAgICAgICAgLy8gZXZlbnQgYWNrIGNhbGxiYWNrXG4gICAgICAgIGlmIChcImZ1bmN0aW9uXCIgPT09IHR5cGVvZiBhcmdzW2FyZ3MubGVuZ3RoIC0gMV0pIHtcbiAgICAgICAgICAgIGNvbnN0IGlkID0gdGhpcy5pZHMrKztcbiAgICAgICAgICAgIGNvbnN0IGFjayA9IGFyZ3MucG9wKCk7XG4gICAgICAgICAgICB0aGlzLl9yZWdpc3RlckFja0NhbGxiYWNrKGlkLCBhY2spO1xuICAgICAgICAgICAgcGFja2V0LmlkID0gaWQ7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgaXNUcmFuc3BvcnRXcml0YWJsZSA9IHRoaXMuaW8uZW5naW5lICYmXG4gICAgICAgICAgICB0aGlzLmlvLmVuZ2luZS50cmFuc3BvcnQgJiZcbiAgICAgICAgICAgIHRoaXMuaW8uZW5naW5lLnRyYW5zcG9ydC53cml0YWJsZTtcbiAgICAgICAgY29uc3QgZGlzY2FyZFBhY2tldCA9IHRoaXMuZmxhZ3Mudm9sYXRpbGUgJiYgKCFpc1RyYW5zcG9ydFdyaXRhYmxlIHx8ICF0aGlzLmNvbm5lY3RlZCk7XG4gICAgICAgIGlmIChkaXNjYXJkUGFja2V0KSB7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAodGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIHRoaXMubm90aWZ5T3V0Z29pbmdMaXN0ZW5lcnMocGFja2V0KTtcbiAgICAgICAgICAgIHRoaXMucGFja2V0KHBhY2tldCk7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB0aGlzLnNlbmRCdWZmZXIucHVzaChwYWNrZXQpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuZmxhZ3MgPSB7fTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgX3JlZ2lzdGVyQWNrQ2FsbGJhY2soaWQsIGFjaykge1xuICAgICAgICB2YXIgX2E7XG4gICAgICAgIGNvbnN0IHRpbWVvdXQgPSAoX2EgPSB0aGlzLmZsYWdzLnRpbWVvdXQpICE9PSBudWxsICYmIF9hICE9PSB2b2lkIDAgPyBfYSA6IHRoaXMuX29wdHMuYWNrVGltZW91dDtcbiAgICAgICAgaWYgKHRpbWVvdXQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhpcy5hY2tzW2lkXSA9IGFjaztcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAvLyBAdHMtaWdub3JlXG4gICAgICAgIGNvbnN0IHRpbWVyID0gdGhpcy5pby5zZXRUaW1lb3V0Rm4oKCkgPT4ge1xuICAgICAgICAgICAgZGVsZXRlIHRoaXMuYWNrc1tpZF07XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuc2VuZEJ1ZmZlci5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLnNlbmRCdWZmZXJbaV0uaWQgPT09IGlkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuc2VuZEJ1ZmZlci5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgYWNrLmNhbGwodGhpcywgbmV3IEVycm9yKFwib3BlcmF0aW9uIGhhcyB0aW1lZCBvdXRcIikpO1xuICAgICAgICB9LCB0aW1lb3V0KTtcbiAgICAgICAgY29uc3QgZm4gPSAoLi4uYXJncykgPT4ge1xuICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgdGhpcy5pby5jbGVhclRpbWVvdXRGbih0aW1lcik7XG4gICAgICAgICAgICBhY2suYXBwbHkodGhpcywgYXJncyk7XG4gICAgICAgIH07XG4gICAgICAgIGZuLndpdGhFcnJvciA9IHRydWU7XG4gICAgICAgIHRoaXMuYWNrc1tpZF0gPSBmbjtcbiAgICB9XG4gICAgLyoqXG4gICAgICogRW1pdHMgYW4gZXZlbnQgYW5kIHdhaXRzIGZvciBhbiBhY2tub3dsZWRnZW1lbnRcbiAgICAgKlxuICAgICAqIEBleGFtcGxlXG4gICAgICogLy8gd2l0aG91dCB0aW1lb3V0XG4gICAgICogY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBzb2NrZXQuZW1pdFdpdGhBY2soXCJoZWxsb1wiLCBcIndvcmxkXCIpO1xuICAgICAqXG4gICAgICogLy8gd2l0aCBhIHNwZWNpZmljIHRpbWVvdXRcbiAgICAgKiB0cnkge1xuICAgICAqICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCBzb2NrZXQudGltZW91dCgxMDAwKS5lbWl0V2l0aEFjayhcImhlbGxvXCIsIFwid29ybGRcIik7XG4gICAgICogfSBjYXRjaCAoZXJyKSB7XG4gICAgICogICAvLyB0aGUgc2VydmVyIGRpZCBub3QgYWNrbm93bGVkZ2UgdGhlIGV2ZW50IGluIHRoZSBnaXZlbiBkZWxheVxuICAgICAqIH1cbiAgICAgKlxuICAgICAqIEByZXR1cm4gYSBQcm9taXNlIHRoYXQgd2lsbCBiZSBmdWxmaWxsZWQgd2hlbiB0aGUgc2VydmVyIGFja25vd2xlZGdlcyB0aGUgZXZlbnRcbiAgICAgKi9cbiAgICBlbWl0V2l0aEFjayhldiwgLi4uYXJncykge1xuICAgICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZm4gPSAoYXJnMSwgYXJnMikgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybiBhcmcxID8gcmVqZWN0KGFyZzEpIDogcmVzb2x2ZShhcmcyKTtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBmbi53aXRoRXJyb3IgPSB0cnVlO1xuICAgICAgICAgICAgYXJncy5wdXNoKGZuKTtcbiAgICAgICAgICAgIHRoaXMuZW1pdChldiwgLi4uYXJncyk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBBZGQgdGhlIHBhY2tldCB0byB0aGUgcXVldWUuXG4gICAgICogQHBhcmFtIGFyZ3NcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIF9hZGRUb1F1ZXVlKGFyZ3MpIHtcbiAgICAgICAgbGV0IGFjaztcbiAgICAgICAgaWYgKHR5cGVvZiBhcmdzW2FyZ3MubGVuZ3RoIC0gMV0gPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgYWNrID0gYXJncy5wb3AoKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwYWNrZXQgPSB7XG4gICAgICAgICAgICBpZDogdGhpcy5fcXVldWVTZXErKyxcbiAgICAgICAgICAgIHRyeUNvdW50OiAwLFxuICAgICAgICAgICAgcGVuZGluZzogZmFsc2UsXG4gICAgICAgICAgICBhcmdzLFxuICAgICAgICAgICAgZmxhZ3M6IE9iamVjdC5hc3NpZ24oeyBmcm9tUXVldWU6IHRydWUgfSwgdGhpcy5mbGFncyksXG4gICAgICAgIH07XG4gICAgICAgIGFyZ3MucHVzaCgoZXJyLCAuLi5yZXNwb25zZUFyZ3MpID0+IHtcbiAgICAgICAgICAgIGlmIChwYWNrZXQgIT09IHRoaXMuX3F1ZXVlWzBdKSB7XG4gICAgICAgICAgICAgICAgLy8gdGhlIHBhY2tldCBoYXMgYWxyZWFkeSBiZWVuIGFja25vd2xlZGdlZFxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IGhhc0Vycm9yID0gZXJyICE9PSBudWxsO1xuICAgICAgICAgICAgaWYgKGhhc0Vycm9yKSB7XG4gICAgICAgICAgICAgICAgaWYgKHBhY2tldC50cnlDb3VudCA+IHRoaXMuX29wdHMucmV0cmllcykge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9xdWV1ZS5zaGlmdCgpO1xuICAgICAgICAgICAgICAgICAgICBpZiAoYWNrKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBhY2soZXJyKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2Uge1xuICAgICAgICAgICAgICAgIHRoaXMuX3F1ZXVlLnNoaWZ0KCk7XG4gICAgICAgICAgICAgICAgaWYgKGFjaykge1xuICAgICAgICAgICAgICAgICAgICBhY2sobnVsbCwgLi4ucmVzcG9uc2VBcmdzKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYWNrZXQucGVuZGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2RyYWluUXVldWUoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuX3F1ZXVlLnB1c2gocGFja2V0KTtcbiAgICAgICAgdGhpcy5fZHJhaW5RdWV1ZSgpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTZW5kIHRoZSBmaXJzdCBwYWNrZXQgb2YgdGhlIHF1ZXVlLCBhbmQgd2FpdCBmb3IgYW4gYWNrbm93bGVkZ2VtZW50IGZyb20gdGhlIHNlcnZlci5cbiAgICAgKiBAcGFyYW0gZm9yY2UgLSB3aGV0aGVyIHRvIHJlc2VuZCBhIHBhY2tldCB0aGF0IGhhcyBub3QgYmVlbiBhY2tub3dsZWRnZWQgeWV0XG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIF9kcmFpblF1ZXVlKGZvcmNlID0gZmFsc2UpIHtcbiAgICAgICAgaWYgKCF0aGlzLmNvbm5lY3RlZCB8fCB0aGlzLl9xdWV1ZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBwYWNrZXQgPSB0aGlzLl9xdWV1ZVswXTtcbiAgICAgICAgaWYgKHBhY2tldC5wZW5kaW5nICYmICFmb3JjZSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHBhY2tldC5wZW5kaW5nID0gdHJ1ZTtcbiAgICAgICAgcGFja2V0LnRyeUNvdW50Kys7XG4gICAgICAgIHRoaXMuZmxhZ3MgPSBwYWNrZXQuZmxhZ3M7XG4gICAgICAgIHRoaXMuZW1pdC5hcHBseSh0aGlzLCBwYWNrZXQuYXJncyk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNlbmRzIGEgcGFja2V0LlxuICAgICAqXG4gICAgICogQHBhcmFtIHBhY2tldFxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgcGFja2V0KHBhY2tldCkge1xuICAgICAgICBwYWNrZXQubnNwID0gdGhpcy5uc3A7XG4gICAgICAgIHRoaXMuaW8uX3BhY2tldChwYWNrZXQpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBlbmdpbmUgYG9wZW5gLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbm9wZW4oKSB7XG4gICAgICAgIGlmICh0eXBlb2YgdGhpcy5hdXRoID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICAgICAgdGhpcy5hdXRoKChkYXRhKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2VuZENvbm5lY3RQYWNrZXQoZGF0YSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX3NlbmRDb25uZWN0UGFja2V0KHRoaXMuYXV0aCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogU2VuZHMgYSBDT05ORUNUIHBhY2tldCB0byBpbml0aWF0ZSB0aGUgU29ja2V0LklPIHNlc3Npb24uXG4gICAgICpcbiAgICAgKiBAcGFyYW0gZGF0YVxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgX3NlbmRDb25uZWN0UGFja2V0KGRhdGEpIHtcbiAgICAgICAgdGhpcy5wYWNrZXQoe1xuICAgICAgICAgICAgdHlwZTogUGFja2V0VHlwZS5DT05ORUNULFxuICAgICAgICAgICAgZGF0YTogdGhpcy5fcGlkXG4gICAgICAgICAgICAgICAgPyBPYmplY3QuYXNzaWduKHsgcGlkOiB0aGlzLl9waWQsIG9mZnNldDogdGhpcy5fbGFzdE9mZnNldCB9LCBkYXRhKVxuICAgICAgICAgICAgICAgIDogZGF0YSxcbiAgICAgICAgfSk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB1cG9uIGVuZ2luZSBvciBtYW5hZ2VyIGBlcnJvcmAuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gZXJyXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbmVycm9yKGVycikge1xuICAgICAgICBpZiAoIXRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcImNvbm5lY3RfZXJyb3JcIiwgZXJyKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBlbmdpbmUgYGNsb3NlYC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSByZWFzb25cbiAgICAgKiBAcGFyYW0gZGVzY3JpcHRpb25cbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9uY2xvc2UocmVhc29uLCBkZXNjcmlwdGlvbikge1xuICAgICAgICB0aGlzLmNvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICBkZWxldGUgdGhpcy5pZDtcbiAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJkaXNjb25uZWN0XCIsIHJlYXNvbiwgZGVzY3JpcHRpb24pO1xuICAgICAgICB0aGlzLl9jbGVhckFja3MoKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2xlYXJzIHRoZSBhY2tub3dsZWRnZW1lbnQgaGFuZGxlcnMgdXBvbiBkaXNjb25uZWN0aW9uLCBzaW5jZSB0aGUgY2xpZW50IHdpbGwgbmV2ZXIgcmVjZWl2ZSBhbiBhY2tub3dsZWRnZW1lbnQgZnJvbVxuICAgICAqIHRoZSBzZXJ2ZXIuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIF9jbGVhckFja3MoKSB7XG4gICAgICAgIE9iamVjdC5rZXlzKHRoaXMuYWNrcykuZm9yRWFjaCgoaWQpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGlzQnVmZmVyZWQgPSB0aGlzLnNlbmRCdWZmZXIuc29tZSgocGFja2V0KSA9PiBTdHJpbmcocGFja2V0LmlkKSA9PT0gaWQpO1xuICAgICAgICAgICAgaWYgKCFpc0J1ZmZlcmVkKSB7XG4gICAgICAgICAgICAgICAgLy8gbm90ZTogaGFuZGxlcnMgdGhhdCBkbyBub3QgYWNjZXB0IGFuIGVycm9yIGFzIGZpcnN0IGFyZ3VtZW50IGFyZSBpZ25vcmVkIGhlcmVcbiAgICAgICAgICAgICAgICBjb25zdCBhY2sgPSB0aGlzLmFja3NbaWRdO1xuICAgICAgICAgICAgICAgIGRlbGV0ZSB0aGlzLmFja3NbaWRdO1xuICAgICAgICAgICAgICAgIGlmIChhY2sud2l0aEVycm9yKSB7XG4gICAgICAgICAgICAgICAgICAgIGFjay5jYWxsKHRoaXMsIG5ldyBFcnJvcihcInNvY2tldCBoYXMgYmVlbiBkaXNjb25uZWN0ZWRcIikpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB3aXRoIHNvY2tldCBwYWNrZXQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gcGFja2V0XG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbnBhY2tldChwYWNrZXQpIHtcbiAgICAgICAgY29uc3Qgc2FtZU5hbWVzcGFjZSA9IHBhY2tldC5uc3AgPT09IHRoaXMubnNwO1xuICAgICAgICBpZiAoIXNhbWVOYW1lc3BhY2UpXG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIHN3aXRjaCAocGFja2V0LnR5cGUpIHtcbiAgICAgICAgICAgIGNhc2UgUGFja2V0VHlwZS5DT05ORUNUOlxuICAgICAgICAgICAgICAgIGlmIChwYWNrZXQuZGF0YSAmJiBwYWNrZXQuZGF0YS5zaWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5vbmNvbm5lY3QocGFja2V0LmRhdGEuc2lkLCBwYWNrZXQuZGF0YS5waWQpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJjb25uZWN0X2Vycm9yXCIsIG5ldyBFcnJvcihcIkl0IHNlZW1zIHlvdSBhcmUgdHJ5aW5nIHRvIHJlYWNoIGEgU29ja2V0LklPIHNlcnZlciBpbiB2Mi54IHdpdGggYSB2My54IGNsaWVudCwgYnV0IHRoZXkgYXJlIG5vdCBjb21wYXRpYmxlIChtb3JlIGluZm9ybWF0aW9uIGhlcmU6IGh0dHBzOi8vc29ja2V0LmlvL2RvY3MvdjMvbWlncmF0aW5nLWZyb20tMi14LXRvLTMtMC8pXCIpKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlIFBhY2tldFR5cGUuRVZFTlQ6XG4gICAgICAgICAgICBjYXNlIFBhY2tldFR5cGUuQklOQVJZX0VWRU5UOlxuICAgICAgICAgICAgICAgIHRoaXMub25ldmVudChwYWNrZXQpO1xuICAgICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgY2FzZSBQYWNrZXRUeXBlLkFDSzpcbiAgICAgICAgICAgIGNhc2UgUGFja2V0VHlwZS5CSU5BUllfQUNLOlxuICAgICAgICAgICAgICAgIHRoaXMub25hY2socGFja2V0KTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIGNhc2UgUGFja2V0VHlwZS5ESVNDT05ORUNUOlxuICAgICAgICAgICAgICAgIHRoaXMub25kaXNjb25uZWN0KCk7XG4gICAgICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgICBjYXNlIFBhY2tldFR5cGUuQ09OTkVDVF9FUlJPUjpcbiAgICAgICAgICAgICAgICB0aGlzLmRlc3Ryb3koKTtcbiAgICAgICAgICAgICAgICBjb25zdCBlcnIgPSBuZXcgRXJyb3IocGFja2V0LmRhdGEubWVzc2FnZSk7XG4gICAgICAgICAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICAgICAgICAgIGVyci5kYXRhID0gcGFja2V0LmRhdGEuZGF0YTtcbiAgICAgICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcImNvbm5lY3RfZXJyb3JcIiwgZXJyKTtcbiAgICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBhIHNlcnZlciBldmVudC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBwYWNrZXRcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9uZXZlbnQocGFja2V0KSB7XG4gICAgICAgIGNvbnN0IGFyZ3MgPSBwYWNrZXQuZGF0YSB8fCBbXTtcbiAgICAgICAgaWYgKG51bGwgIT0gcGFja2V0LmlkKSB7XG4gICAgICAgICAgICBhcmdzLnB1c2godGhpcy5hY2socGFja2V0LmlkKSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICB0aGlzLmVtaXRFdmVudChhcmdzKTtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMucmVjZWl2ZUJ1ZmZlci5wdXNoKE9iamVjdC5mcmVlemUoYXJncykpO1xuICAgICAgICB9XG4gICAgfVxuICAgIGVtaXRFdmVudChhcmdzKSB7XG4gICAgICAgIGlmICh0aGlzLl9hbnlMaXN0ZW5lcnMgJiYgdGhpcy5fYW55TGlzdGVuZXJzLmxlbmd0aCkge1xuICAgICAgICAgICAgY29uc3QgbGlzdGVuZXJzID0gdGhpcy5fYW55TGlzdGVuZXJzLnNsaWNlKCk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIGxpc3RlbmVycykge1xuICAgICAgICAgICAgICAgIGxpc3RlbmVyLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHN1cGVyLmVtaXQuYXBwbHkodGhpcywgYXJncyk7XG4gICAgICAgIGlmICh0aGlzLl9waWQgJiYgYXJncy5sZW5ndGggJiYgdHlwZW9mIGFyZ3NbYXJncy5sZW5ndGggLSAxXSA9PT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgdGhpcy5fbGFzdE9mZnNldCA9IGFyZ3NbYXJncy5sZW5ndGggLSAxXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBQcm9kdWNlcyBhbiBhY2sgY2FsbGJhY2sgdG8gZW1pdCB3aXRoIGFuIGV2ZW50LlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBhY2soaWQpIHtcbiAgICAgICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgICAgIGxldCBzZW50ID0gZmFsc2U7XG4gICAgICAgIHJldHVybiBmdW5jdGlvbiAoLi4uYXJncykge1xuICAgICAgICAgICAgLy8gcHJldmVudCBkb3VibGUgY2FsbGJhY2tzXG4gICAgICAgICAgICBpZiAoc2VudClcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICBzZW50ID0gdHJ1ZTtcbiAgICAgICAgICAgIHNlbGYucGFja2V0KHtcbiAgICAgICAgICAgICAgICB0eXBlOiBQYWNrZXRUeXBlLkFDSyxcbiAgICAgICAgICAgICAgICBpZDogaWQsXG4gICAgICAgICAgICAgICAgZGF0YTogYXJncyxcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBhIHNlcnZlciBhY2tub3dsZWRnZW1lbnQuXG4gICAgICpcbiAgICAgKiBAcGFyYW0gcGFja2V0XG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbmFjayhwYWNrZXQpIHtcbiAgICAgICAgY29uc3QgYWNrID0gdGhpcy5hY2tzW3BhY2tldC5pZF07XG4gICAgICAgIGlmICh0eXBlb2YgYWNrICE9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBkZWxldGUgdGhpcy5hY2tzW3BhY2tldC5pZF07XG4gICAgICAgIC8vIEB0cy1pZ25vcmUgRklYTUUgYWNrIGlzIGluY29ycmVjdGx5IGluZmVycmVkIGFzICduZXZlcidcbiAgICAgICAgaWYgKGFjay53aXRoRXJyb3IpIHtcbiAgICAgICAgICAgIHBhY2tldC5kYXRhLnVuc2hpZnQobnVsbCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gQHRzLWlnbm9yZVxuICAgICAgICBhY2suYXBwbHkodGhpcywgcGFja2V0LmRhdGEpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBzZXJ2ZXIgY29ubmVjdC5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgb25jb25uZWN0KGlkLCBwaWQpIHtcbiAgICAgICAgdGhpcy5pZCA9IGlkO1xuICAgICAgICB0aGlzLnJlY292ZXJlZCA9IHBpZCAmJiB0aGlzLl9waWQgPT09IHBpZDtcbiAgICAgICAgdGhpcy5fcGlkID0gcGlkOyAvLyBkZWZpbmVkIG9ubHkgaWYgY29ubmVjdGlvbiBzdGF0ZSByZWNvdmVyeSBpcyBlbmFibGVkXG4gICAgICAgIHRoaXMuY29ubmVjdGVkID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5lbWl0QnVmZmVyZWQoKTtcbiAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJjb25uZWN0XCIpO1xuICAgICAgICB0aGlzLl9kcmFpblF1ZXVlKHRydWUpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBFbWl0IGJ1ZmZlcmVkIGV2ZW50cyAocmVjZWl2ZWQgYW5kIGVtaXR0ZWQpLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBlbWl0QnVmZmVyZWQoKSB7XG4gICAgICAgIHRoaXMucmVjZWl2ZUJ1ZmZlci5mb3JFYWNoKChhcmdzKSA9PiB0aGlzLmVtaXRFdmVudChhcmdzKSk7XG4gICAgICAgIHRoaXMucmVjZWl2ZUJ1ZmZlciA9IFtdO1xuICAgICAgICB0aGlzLnNlbmRCdWZmZXIuZm9yRWFjaCgocGFja2V0KSA9PiB7XG4gICAgICAgICAgICB0aGlzLm5vdGlmeU91dGdvaW5nTGlzdGVuZXJzKHBhY2tldCk7XG4gICAgICAgICAgICB0aGlzLnBhY2tldChwYWNrZXQpO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5zZW5kQnVmZmVyID0gW107XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB1cG9uIHNlcnZlciBkaXNjb25uZWN0LlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbmRpc2Nvbm5lY3QoKSB7XG4gICAgICAgIHRoaXMuZGVzdHJveSgpO1xuICAgICAgICB0aGlzLm9uY2xvc2UoXCJpbyBzZXJ2ZXIgZGlzY29ubmVjdFwiKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHVwb24gZm9yY2VkIGNsaWVudC9zZXJ2ZXIgc2lkZSBkaXNjb25uZWN0aW9ucyxcbiAgICAgKiB0aGlzIG1ldGhvZCBlbnN1cmVzIHRoZSBtYW5hZ2VyIHN0b3BzIHRyYWNraW5nIHVzIGFuZFxuICAgICAqIHRoYXQgcmVjb25uZWN0aW9ucyBkb24ndCBnZXQgdHJpZ2dlcmVkIGZvciB0aGlzLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBkZXN0cm95KCkge1xuICAgICAgICBpZiAodGhpcy5zdWJzKSB7XG4gICAgICAgICAgICAvLyBjbGVhbiBzdWJzY3JpcHRpb25zIHRvIGF2b2lkIHJlY29ubmVjdGlvbnNcbiAgICAgICAgICAgIHRoaXMuc3Vicy5mb3JFYWNoKChzdWJEZXN0cm95KSA9PiBzdWJEZXN0cm95KCkpO1xuICAgICAgICAgICAgdGhpcy5zdWJzID0gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuaW9bXCJfZGVzdHJveVwiXSh0aGlzKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogRGlzY29ubmVjdHMgdGhlIHNvY2tldCBtYW51YWxseS4gSW4gdGhhdCBjYXNlLCB0aGUgc29ja2V0IHdpbGwgbm90IHRyeSB0byByZWNvbm5lY3QuXG4gICAgICpcbiAgICAgKiBJZiB0aGlzIGlzIHRoZSBsYXN0IGFjdGl2ZSBTb2NrZXQgaW5zdGFuY2Ugb2YgdGhlIHtAbGluayBNYW5hZ2VyfSwgdGhlIGxvdy1sZXZlbCBjb25uZWN0aW9uIHdpbGwgYmUgY2xvc2VkLlxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBjb25zdCBzb2NrZXQgPSBpbygpO1xuICAgICAqXG4gICAgICogc29ja2V0Lm9uKFwiZGlzY29ubmVjdFwiLCAocmVhc29uKSA9PiB7XG4gICAgICogICAvLyBjb25zb2xlLmxvZyhyZWFzb24pOyBwcmludHMgXCJpbyBjbGllbnQgZGlzY29ubmVjdFwiXG4gICAgICogfSk7XG4gICAgICpcbiAgICAgKiBzb2NrZXQuZGlzY29ubmVjdCgpO1xuICAgICAqXG4gICAgICogQHJldHVybiBzZWxmXG4gICAgICovXG4gICAgZGlzY29ubmVjdCgpIHtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICB0aGlzLnBhY2tldCh7IHR5cGU6IFBhY2tldFR5cGUuRElTQ09OTkVDVCB9KTtcbiAgICAgICAgfVxuICAgICAgICAvLyByZW1vdmUgc29ja2V0IGZyb20gcG9vbFxuICAgICAgICB0aGlzLmRlc3Ryb3koKTtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICAvLyBmaXJlIGV2ZW50c1xuICAgICAgICAgICAgdGhpcy5vbmNsb3NlKFwiaW8gY2xpZW50IGRpc2Nvbm5lY3RcIik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEFsaWFzIGZvciB7QGxpbmsgZGlzY29ubmVjdCgpfS5cbiAgICAgKlxuICAgICAqIEByZXR1cm4gc2VsZlxuICAgICAqL1xuICAgIGNsb3NlKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5kaXNjb25uZWN0KCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFNldHMgdGhlIGNvbXByZXNzIGZsYWcuXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIHNvY2tldC5jb21wcmVzcyhmYWxzZSkuZW1pdChcImhlbGxvXCIpO1xuICAgICAqXG4gICAgICogQHBhcmFtIGNvbXByZXNzIC0gaWYgYHRydWVgLCBjb21wcmVzc2VzIHRoZSBzZW5kaW5nIGRhdGFcbiAgICAgKiBAcmV0dXJuIHNlbGZcbiAgICAgKi9cbiAgICBjb21wcmVzcyhjb21wcmVzcykge1xuICAgICAgICB0aGlzLmZsYWdzLmNvbXByZXNzID0gY29tcHJlc3M7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTZXRzIGEgbW9kaWZpZXIgZm9yIGEgc3Vic2VxdWVudCBldmVudCBlbWlzc2lvbiB0aGF0IHRoZSBldmVudCBtZXNzYWdlIHdpbGwgYmUgZHJvcHBlZCB3aGVuIHRoaXMgc29ja2V0IGlzIG5vdFxuICAgICAqIHJlYWR5IHRvIHNlbmQgbWVzc2FnZXMuXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIHNvY2tldC52b2xhdGlsZS5lbWl0KFwiaGVsbG9cIik7IC8vIHRoZSBzZXJ2ZXIgbWF5IG9yIG1heSBub3QgcmVjZWl2ZSBpdFxuICAgICAqXG4gICAgICogQHJldHVybnMgc2VsZlxuICAgICAqL1xuICAgIGdldCB2b2xhdGlsZSgpIHtcbiAgICAgICAgdGhpcy5mbGFncy52b2xhdGlsZSA9IHRydWU7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBTZXRzIGEgbW9kaWZpZXIgZm9yIGEgc3Vic2VxdWVudCBldmVudCBlbWlzc2lvbiB0aGF0IHRoZSBjYWxsYmFjayB3aWxsIGJlIGNhbGxlZCB3aXRoIGFuIGVycm9yIHdoZW4gdGhlXG4gICAgICogZ2l2ZW4gbnVtYmVyIG9mIG1pbGxpc2Vjb25kcyBoYXZlIGVsYXBzZWQgd2l0aG91dCBhbiBhY2tub3dsZWRnZW1lbnQgZnJvbSB0aGUgc2VydmVyOlxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBzb2NrZXQudGltZW91dCg1MDAwKS5lbWl0KFwibXktZXZlbnRcIiwgKGVycikgPT4ge1xuICAgICAqICAgaWYgKGVycikge1xuICAgICAqICAgICAvLyB0aGUgc2VydmVyIGRpZCBub3QgYWNrbm93bGVkZ2UgdGhlIGV2ZW50IGluIHRoZSBnaXZlbiBkZWxheVxuICAgICAqICAgfVxuICAgICAqIH0pO1xuICAgICAqXG4gICAgICogQHJldHVybnMgc2VsZlxuICAgICAqL1xuICAgIHRpbWVvdXQodGltZW91dCkge1xuICAgICAgICB0aGlzLmZsYWdzLnRpbWVvdXQgPSB0aW1lb3V0O1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgLyoqXG4gICAgICogQWRkcyBhIGxpc3RlbmVyIHRoYXQgd2lsbCBiZSBmaXJlZCB3aGVuIGFueSBldmVudCBpcyBlbWl0dGVkLiBUaGUgZXZlbnQgbmFtZSBpcyBwYXNzZWQgYXMgdGhlIGZpcnN0IGFyZ3VtZW50IHRvIHRoZVxuICAgICAqIGNhbGxiYWNrLlxuICAgICAqXG4gICAgICogQGV4YW1wbGVcbiAgICAgKiBzb2NrZXQub25BbnkoKGV2ZW50LCAuLi5hcmdzKSA9PiB7XG4gICAgICogICBjb25zb2xlLmxvZyhgZ290ICR7ZXZlbnR9YCk7XG4gICAgICogfSk7XG4gICAgICpcbiAgICAgKiBAcGFyYW0gbGlzdGVuZXJcbiAgICAgKi9cbiAgICBvbkFueShsaXN0ZW5lcikge1xuICAgICAgICB0aGlzLl9hbnlMaXN0ZW5lcnMgPSB0aGlzLl9hbnlMaXN0ZW5lcnMgfHwgW107XG4gICAgICAgIHRoaXMuX2FueUxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEFkZHMgYSBsaXN0ZW5lciB0aGF0IHdpbGwgYmUgZmlyZWQgd2hlbiBhbnkgZXZlbnQgaXMgZW1pdHRlZC4gVGhlIGV2ZW50IG5hbWUgaXMgcGFzc2VkIGFzIHRoZSBmaXJzdCBhcmd1bWVudCB0byB0aGVcbiAgICAgKiBjYWxsYmFjay4gVGhlIGxpc3RlbmVyIGlzIGFkZGVkIHRvIHRoZSBiZWdpbm5pbmcgb2YgdGhlIGxpc3RlbmVycyBhcnJheS5cbiAgICAgKlxuICAgICAqIEBleGFtcGxlXG4gICAgICogc29ja2V0LnByZXBlbmRBbnkoKGV2ZW50LCAuLi5hcmdzKSA9PiB7XG4gICAgICogICBjb25zb2xlLmxvZyhgZ290IGV2ZW50ICR7ZXZlbnR9YCk7XG4gICAgICogfSk7XG4gICAgICpcbiAgICAgKiBAcGFyYW0gbGlzdGVuZXJcbiAgICAgKi9cbiAgICBwcmVwZW5kQW55KGxpc3RlbmVyKSB7XG4gICAgICAgIHRoaXMuX2FueUxpc3RlbmVycyA9IHRoaXMuX2FueUxpc3RlbmVycyB8fCBbXTtcbiAgICAgICAgdGhpcy5fYW55TGlzdGVuZXJzLnVuc2hpZnQobGlzdGVuZXIpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgLyoqXG4gICAgICogUmVtb3ZlcyB0aGUgbGlzdGVuZXIgdGhhdCB3aWxsIGJlIGZpcmVkIHdoZW4gYW55IGV2ZW50IGlzIGVtaXR0ZWQuXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGNvbnN0IGNhdGNoQWxsTGlzdGVuZXIgPSAoZXZlbnQsIC4uLmFyZ3MpID0+IHtcbiAgICAgKiAgIGNvbnNvbGUubG9nKGBnb3QgZXZlbnQgJHtldmVudH1gKTtcbiAgICAgKiB9XG4gICAgICpcbiAgICAgKiBzb2NrZXQub25BbnkoY2F0Y2hBbGxMaXN0ZW5lcik7XG4gICAgICpcbiAgICAgKiAvLyByZW1vdmUgYSBzcGVjaWZpYyBsaXN0ZW5lclxuICAgICAqIHNvY2tldC5vZmZBbnkoY2F0Y2hBbGxMaXN0ZW5lcik7XG4gICAgICpcbiAgICAgKiAvLyBvciByZW1vdmUgYWxsIGxpc3RlbmVyc1xuICAgICAqIHNvY2tldC5vZmZBbnkoKTtcbiAgICAgKlxuICAgICAqIEBwYXJhbSBsaXN0ZW5lclxuICAgICAqL1xuICAgIG9mZkFueShsaXN0ZW5lcikge1xuICAgICAgICBpZiAoIXRoaXMuX2FueUxpc3RlbmVycykge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKGxpc3RlbmVyKSB7XG4gICAgICAgICAgICBjb25zdCBsaXN0ZW5lcnMgPSB0aGlzLl9hbnlMaXN0ZW5lcnM7XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpc3RlbmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIGlmIChsaXN0ZW5lciA9PT0gbGlzdGVuZXJzW2ldKSB7XG4gICAgICAgICAgICAgICAgICAgIGxpc3RlbmVycy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2FueUxpc3RlbmVycyA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIGFuIGFycmF5IG9mIGxpc3RlbmVycyB0aGF0IGFyZSBsaXN0ZW5pbmcgZm9yIGFueSBldmVudCB0aGF0IGlzIHNwZWNpZmllZC4gVGhpcyBhcnJheSBjYW4gYmUgbWFuaXB1bGF0ZWQsXG4gICAgICogZS5nLiB0byByZW1vdmUgbGlzdGVuZXJzLlxuICAgICAqL1xuICAgIGxpc3RlbmVyc0FueSgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2FueUxpc3RlbmVycyB8fCBbXTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQWRkcyBhIGxpc3RlbmVyIHRoYXQgd2lsbCBiZSBmaXJlZCB3aGVuIGFueSBldmVudCBpcyBlbWl0dGVkLiBUaGUgZXZlbnQgbmFtZSBpcyBwYXNzZWQgYXMgdGhlIGZpcnN0IGFyZ3VtZW50IHRvIHRoZVxuICAgICAqIGNhbGxiYWNrLlxuICAgICAqXG4gICAgICogTm90ZTogYWNrbm93bGVkZ2VtZW50cyBzZW50IHRvIHRoZSBzZXJ2ZXIgYXJlIG5vdCBpbmNsdWRlZC5cbiAgICAgKlxuICAgICAqIEBleGFtcGxlXG4gICAgICogc29ja2V0Lm9uQW55T3V0Z29pbmcoKGV2ZW50LCAuLi5hcmdzKSA9PiB7XG4gICAgICogICBjb25zb2xlLmxvZyhgc2VudCBldmVudCAke2V2ZW50fWApO1xuICAgICAqIH0pO1xuICAgICAqXG4gICAgICogQHBhcmFtIGxpc3RlbmVyXG4gICAgICovXG4gICAgb25BbnlPdXRnb2luZyhsaXN0ZW5lcikge1xuICAgICAgICB0aGlzLl9hbnlPdXRnb2luZ0xpc3RlbmVycyA9IHRoaXMuX2FueU91dGdvaW5nTGlzdGVuZXJzIHx8IFtdO1xuICAgICAgICB0aGlzLl9hbnlPdXRnb2luZ0xpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEFkZHMgYSBsaXN0ZW5lciB0aGF0IHdpbGwgYmUgZmlyZWQgd2hlbiBhbnkgZXZlbnQgaXMgZW1pdHRlZC4gVGhlIGV2ZW50IG5hbWUgaXMgcGFzc2VkIGFzIHRoZSBmaXJzdCBhcmd1bWVudCB0byB0aGVcbiAgICAgKiBjYWxsYmFjay4gVGhlIGxpc3RlbmVyIGlzIGFkZGVkIHRvIHRoZSBiZWdpbm5pbmcgb2YgdGhlIGxpc3RlbmVycyBhcnJheS5cbiAgICAgKlxuICAgICAqIE5vdGU6IGFja25vd2xlZGdlbWVudHMgc2VudCB0byB0aGUgc2VydmVyIGFyZSBub3QgaW5jbHVkZWQuXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIHNvY2tldC5wcmVwZW5kQW55T3V0Z29pbmcoKGV2ZW50LCAuLi5hcmdzKSA9PiB7XG4gICAgICogICBjb25zb2xlLmxvZyhgc2VudCBldmVudCAke2V2ZW50fWApO1xuICAgICAqIH0pO1xuICAgICAqXG4gICAgICogQHBhcmFtIGxpc3RlbmVyXG4gICAgICovXG4gICAgcHJlcGVuZEFueU91dGdvaW5nKGxpc3RlbmVyKSB7XG4gICAgICAgIHRoaXMuX2FueU91dGdvaW5nTGlzdGVuZXJzID0gdGhpcy5fYW55T3V0Z29pbmdMaXN0ZW5lcnMgfHwgW107XG4gICAgICAgIHRoaXMuX2FueU91dGdvaW5nTGlzdGVuZXJzLnVuc2hpZnQobGlzdGVuZXIpO1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgLyoqXG4gICAgICogUmVtb3ZlcyB0aGUgbGlzdGVuZXIgdGhhdCB3aWxsIGJlIGZpcmVkIHdoZW4gYW55IGV2ZW50IGlzIGVtaXR0ZWQuXG4gICAgICpcbiAgICAgKiBAZXhhbXBsZVxuICAgICAqIGNvbnN0IGNhdGNoQWxsTGlzdGVuZXIgPSAoZXZlbnQsIC4uLmFyZ3MpID0+IHtcbiAgICAgKiAgIGNvbnNvbGUubG9nKGBzZW50IGV2ZW50ICR7ZXZlbnR9YCk7XG4gICAgICogfVxuICAgICAqXG4gICAgICogc29ja2V0Lm9uQW55T3V0Z29pbmcoY2F0Y2hBbGxMaXN0ZW5lcik7XG4gICAgICpcbiAgICAgKiAvLyByZW1vdmUgYSBzcGVjaWZpYyBsaXN0ZW5lclxuICAgICAqIHNvY2tldC5vZmZBbnlPdXRnb2luZyhjYXRjaEFsbExpc3RlbmVyKTtcbiAgICAgKlxuICAgICAqIC8vIG9yIHJlbW92ZSBhbGwgbGlzdGVuZXJzXG4gICAgICogc29ja2V0Lm9mZkFueU91dGdvaW5nKCk7XG4gICAgICpcbiAgICAgKiBAcGFyYW0gW2xpc3RlbmVyXSAtIHRoZSBjYXRjaC1hbGwgbGlzdGVuZXIgKG9wdGlvbmFsKVxuICAgICAqL1xuICAgIG9mZkFueU91dGdvaW5nKGxpc3RlbmVyKSB7XG4gICAgICAgIGlmICghdGhpcy5fYW55T3V0Z29pbmdMaXN0ZW5lcnMpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9XG4gICAgICAgIGlmIChsaXN0ZW5lcikge1xuICAgICAgICAgICAgY29uc3QgbGlzdGVuZXJzID0gdGhpcy5fYW55T3V0Z29pbmdMaXN0ZW5lcnM7XG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxpc3RlbmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIGlmIChsaXN0ZW5lciA9PT0gbGlzdGVuZXJzW2ldKSB7XG4gICAgICAgICAgICAgICAgICAgIGxpc3RlbmVycy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2FueU91dGdvaW5nTGlzdGVuZXJzID0gW107XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFJldHVybnMgYW4gYXJyYXkgb2YgbGlzdGVuZXJzIHRoYXQgYXJlIGxpc3RlbmluZyBmb3IgYW55IGV2ZW50IHRoYXQgaXMgc3BlY2lmaWVkLiBUaGlzIGFycmF5IGNhbiBiZSBtYW5pcHVsYXRlZCxcbiAgICAgKiBlLmcuIHRvIHJlbW92ZSBsaXN0ZW5lcnMuXG4gICAgICovXG4gICAgbGlzdGVuZXJzQW55T3V0Z29pbmcoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9hbnlPdXRnb2luZ0xpc3RlbmVycyB8fCBbXTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogTm90aWZ5IHRoZSBsaXN0ZW5lcnMgZm9yIGVhY2ggcGFja2V0IHNlbnRcbiAgICAgKlxuICAgICAqIEBwYXJhbSBwYWNrZXRcbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgbm90aWZ5T3V0Z29pbmdMaXN0ZW5lcnMocGFja2V0KSB7XG4gICAgICAgIGlmICh0aGlzLl9hbnlPdXRnb2luZ0xpc3RlbmVycyAmJiB0aGlzLl9hbnlPdXRnb2luZ0xpc3RlbmVycy5sZW5ndGgpIHtcbiAgICAgICAgICAgIGNvbnN0IGxpc3RlbmVycyA9IHRoaXMuX2FueU91dGdvaW5nTGlzdGVuZXJzLnNsaWNlKCk7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGxpc3RlbmVyIG9mIGxpc3RlbmVycykge1xuICAgICAgICAgICAgICAgIGxpc3RlbmVyLmFwcGx5KHRoaXMsIHBhY2tldC5kYXRhKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cbiIsIi8qKlxuICogSW5pdGlhbGl6ZSBiYWNrb2ZmIHRpbWVyIHdpdGggYG9wdHNgLlxuICpcbiAqIC0gYG1pbmAgaW5pdGlhbCB0aW1lb3V0IGluIG1pbGxpc2Vjb25kcyBbMTAwXVxuICogLSBgbWF4YCBtYXggdGltZW91dCBbMTAwMDBdXG4gKiAtIGBqaXR0ZXJgIFswXVxuICogLSBgZmFjdG9yYCBbMl1cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0c1xuICogQGFwaSBwdWJsaWNcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIEJhY2tvZmYob3B0cykge1xuICAgIG9wdHMgPSBvcHRzIHx8IHt9O1xuICAgIHRoaXMubXMgPSBvcHRzLm1pbiB8fCAxMDA7XG4gICAgdGhpcy5tYXggPSBvcHRzLm1heCB8fCAxMDAwMDtcbiAgICB0aGlzLmZhY3RvciA9IG9wdHMuZmFjdG9yIHx8IDI7XG4gICAgdGhpcy5qaXR0ZXIgPSBvcHRzLmppdHRlciA+IDAgJiYgb3B0cy5qaXR0ZXIgPD0gMSA/IG9wdHMuaml0dGVyIDogMDtcbiAgICB0aGlzLmF0dGVtcHRzID0gMDtcbn1cbi8qKlxuICogUmV0dXJuIHRoZSBiYWNrb2ZmIGR1cmF0aW9uLlxuICpcbiAqIEByZXR1cm4ge051bWJlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cbkJhY2tvZmYucHJvdG90eXBlLmR1cmF0aW9uID0gZnVuY3Rpb24gKCkge1xuICAgIHZhciBtcyA9IHRoaXMubXMgKiBNYXRoLnBvdyh0aGlzLmZhY3RvciwgdGhpcy5hdHRlbXB0cysrKTtcbiAgICBpZiAodGhpcy5qaXR0ZXIpIHtcbiAgICAgICAgdmFyIHJhbmQgPSBNYXRoLnJhbmRvbSgpO1xuICAgICAgICB2YXIgZGV2aWF0aW9uID0gTWF0aC5mbG9vcihyYW5kICogdGhpcy5qaXR0ZXIgKiBtcyk7XG4gICAgICAgIG1zID0gKE1hdGguZmxvb3IocmFuZCAqIDEwKSAmIDEpID09IDAgPyBtcyAtIGRldmlhdGlvbiA6IG1zICsgZGV2aWF0aW9uO1xuICAgIH1cbiAgICByZXR1cm4gTWF0aC5taW4obXMsIHRoaXMubWF4KSB8IDA7XG59O1xuLyoqXG4gKiBSZXNldCB0aGUgbnVtYmVyIG9mIGF0dGVtcHRzLlxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cbkJhY2tvZmYucHJvdG90eXBlLnJlc2V0ID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuYXR0ZW1wdHMgPSAwO1xufTtcbi8qKlxuICogU2V0IHRoZSBtaW5pbXVtIGR1cmF0aW9uXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuQmFja29mZi5wcm90b3R5cGUuc2V0TWluID0gZnVuY3Rpb24gKG1pbikge1xuICAgIHRoaXMubXMgPSBtaW47XG59O1xuLyoqXG4gKiBTZXQgdGhlIG1heGltdW0gZHVyYXRpb25cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5CYWNrb2ZmLnByb3RvdHlwZS5zZXRNYXggPSBmdW5jdGlvbiAobWF4KSB7XG4gICAgdGhpcy5tYXggPSBtYXg7XG59O1xuLyoqXG4gKiBTZXQgdGhlIGppdHRlclxuICpcbiAqIEBhcGkgcHVibGljXG4gKi9cbkJhY2tvZmYucHJvdG90eXBlLnNldEppdHRlciA9IGZ1bmN0aW9uIChqaXR0ZXIpIHtcbiAgICB0aGlzLmppdHRlciA9IGppdHRlcjtcbn07XG4iLCJpbXBvcnQgeyBTb2NrZXQgYXMgRW5naW5lLCBpbnN0YWxsVGltZXJGdW5jdGlvbnMsIG5leHRUaWNrLCB9IGZyb20gXCJlbmdpbmUuaW8tY2xpZW50XCI7XG5pbXBvcnQgeyBTb2NrZXQgfSBmcm9tIFwiLi9zb2NrZXQuanNcIjtcbmltcG9ydCAqIGFzIHBhcnNlciBmcm9tIFwic29ja2V0LmlvLXBhcnNlclwiO1xuaW1wb3J0IHsgb24gfSBmcm9tIFwiLi9vbi5qc1wiO1xuaW1wb3J0IHsgQmFja29mZiB9IGZyb20gXCIuL2NvbnRyaWIvYmFja28yLmpzXCI7XG5pbXBvcnQgeyBFbWl0dGVyLCB9IGZyb20gXCJAc29ja2V0LmlvL2NvbXBvbmVudC1lbWl0dGVyXCI7XG5leHBvcnQgY2xhc3MgTWFuYWdlciBleHRlbmRzIEVtaXR0ZXIge1xuICAgIGNvbnN0cnVjdG9yKHVyaSwgb3B0cykge1xuICAgICAgICB2YXIgX2E7XG4gICAgICAgIHN1cGVyKCk7XG4gICAgICAgIHRoaXMubnNwcyA9IHt9O1xuICAgICAgICB0aGlzLnN1YnMgPSBbXTtcbiAgICAgICAgaWYgKHVyaSAmJiBcIm9iamVjdFwiID09PSB0eXBlb2YgdXJpKSB7XG4gICAgICAgICAgICBvcHRzID0gdXJpO1xuICAgICAgICAgICAgdXJpID0gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIG9wdHMgPSBvcHRzIHx8IHt9O1xuICAgICAgICBvcHRzLnBhdGggPSBvcHRzLnBhdGggfHwgXCIvc29ja2V0LmlvXCI7XG4gICAgICAgIHRoaXMub3B0cyA9IG9wdHM7XG4gICAgICAgIGluc3RhbGxUaW1lckZ1bmN0aW9ucyh0aGlzLCBvcHRzKTtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb24ob3B0cy5yZWNvbm5lY3Rpb24gIT09IGZhbHNlKTtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25BdHRlbXB0cyhvcHRzLnJlY29ubmVjdGlvbkF0dGVtcHRzIHx8IEluZmluaXR5KTtcbiAgICAgICAgdGhpcy5yZWNvbm5lY3Rpb25EZWxheShvcHRzLnJlY29ubmVjdGlvbkRlbGF5IHx8IDEwMDApO1xuICAgICAgICB0aGlzLnJlY29ubmVjdGlvbkRlbGF5TWF4KG9wdHMucmVjb25uZWN0aW9uRGVsYXlNYXggfHwgNTAwMCk7XG4gICAgICAgIHRoaXMucmFuZG9taXphdGlvbkZhY3RvcigoX2EgPSBvcHRzLnJhbmRvbWl6YXRpb25GYWN0b3IpICE9PSBudWxsICYmIF9hICE9PSB2b2lkIDAgPyBfYSA6IDAuNSk7XG4gICAgICAgIHRoaXMuYmFja29mZiA9IG5ldyBCYWNrb2ZmKHtcbiAgICAgICAgICAgIG1pbjogdGhpcy5yZWNvbm5lY3Rpb25EZWxheSgpLFxuICAgICAgICAgICAgbWF4OiB0aGlzLnJlY29ubmVjdGlvbkRlbGF5TWF4KCksXG4gICAgICAgICAgICBqaXR0ZXI6IHRoaXMucmFuZG9taXphdGlvbkZhY3RvcigpLFxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy50aW1lb3V0KG51bGwgPT0gb3B0cy50aW1lb3V0ID8gMjAwMDAgOiBvcHRzLnRpbWVvdXQpO1xuICAgICAgICB0aGlzLl9yZWFkeVN0YXRlID0gXCJjbG9zZWRcIjtcbiAgICAgICAgdGhpcy51cmkgPSB1cmk7XG4gICAgICAgIGNvbnN0IF9wYXJzZXIgPSBvcHRzLnBhcnNlciB8fCBwYXJzZXI7XG4gICAgICAgIHRoaXMuZW5jb2RlciA9IG5ldyBfcGFyc2VyLkVuY29kZXIoKTtcbiAgICAgICAgdGhpcy5kZWNvZGVyID0gbmV3IF9wYXJzZXIuRGVjb2RlcigpO1xuICAgICAgICB0aGlzLl9hdXRvQ29ubmVjdCA9IG9wdHMuYXV0b0Nvbm5lY3QgIT09IGZhbHNlO1xuICAgICAgICBpZiAodGhpcy5fYXV0b0Nvbm5lY3QpXG4gICAgICAgICAgICB0aGlzLm9wZW4oKTtcbiAgICB9XG4gICAgcmVjb25uZWN0aW9uKHYpIHtcbiAgICAgICAgaWYgKCFhcmd1bWVudHMubGVuZ3RoKVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3JlY29ubmVjdGlvbjtcbiAgICAgICAgdGhpcy5fcmVjb25uZWN0aW9uID0gISF2O1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgcmVjb25uZWN0aW9uQXR0ZW1wdHModikge1xuICAgICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3JlY29ubmVjdGlvbkF0dGVtcHRzO1xuICAgICAgICB0aGlzLl9yZWNvbm5lY3Rpb25BdHRlbXB0cyA9IHY7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICByZWNvbm5lY3Rpb25EZWxheSh2KSB7XG4gICAgICAgIHZhciBfYTtcbiAgICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZClcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9yZWNvbm5lY3Rpb25EZWxheTtcbiAgICAgICAgdGhpcy5fcmVjb25uZWN0aW9uRGVsYXkgPSB2O1xuICAgICAgICAoX2EgPSB0aGlzLmJhY2tvZmYpID09PSBudWxsIHx8IF9hID09PSB2b2lkIDAgPyB2b2lkIDAgOiBfYS5zZXRNaW4odik7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICByYW5kb21pemF0aW9uRmFjdG9yKHYpIHtcbiAgICAgICAgdmFyIF9hO1xuICAgICAgICBpZiAodiA9PT0gdW5kZWZpbmVkKVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3JhbmRvbWl6YXRpb25GYWN0b3I7XG4gICAgICAgIHRoaXMuX3JhbmRvbWl6YXRpb25GYWN0b3IgPSB2O1xuICAgICAgICAoX2EgPSB0aGlzLmJhY2tvZmYpID09PSBudWxsIHx8IF9hID09PSB2b2lkIDAgPyB2b2lkIDAgOiBfYS5zZXRKaXR0ZXIodik7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICByZWNvbm5lY3Rpb25EZWxheU1heCh2KSB7XG4gICAgICAgIHZhciBfYTtcbiAgICAgICAgaWYgKHYgPT09IHVuZGVmaW5lZClcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9yZWNvbm5lY3Rpb25EZWxheU1heDtcbiAgICAgICAgdGhpcy5fcmVjb25uZWN0aW9uRGVsYXlNYXggPSB2O1xuICAgICAgICAoX2EgPSB0aGlzLmJhY2tvZmYpID09PSBudWxsIHx8IF9hID09PSB2b2lkIDAgPyB2b2lkIDAgOiBfYS5zZXRNYXgodik7XG4gICAgICAgIHJldHVybiB0aGlzO1xuICAgIH1cbiAgICB0aW1lb3V0KHYpIHtcbiAgICAgICAgaWYgKCFhcmd1bWVudHMubGVuZ3RoKVxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX3RpbWVvdXQ7XG4gICAgICAgIHRoaXMuX3RpbWVvdXQgPSB2O1xuICAgICAgICByZXR1cm4gdGhpcztcbiAgICB9XG4gICAgLyoqXG4gICAgICogU3RhcnRzIHRyeWluZyB0byByZWNvbm5lY3QgaWYgcmVjb25uZWN0aW9uIGlzIGVuYWJsZWQgYW5kIHdlIGhhdmUgbm90XG4gICAgICogc3RhcnRlZCByZWNvbm5lY3RpbmcgeWV0XG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG1heWJlUmVjb25uZWN0T25PcGVuKCkge1xuICAgICAgICAvLyBPbmx5IHRyeSB0byByZWNvbm5lY3QgaWYgaXQncyB0aGUgZmlyc3QgdGltZSB3ZSdyZSBjb25uZWN0aW5nXG4gICAgICAgIGlmICghdGhpcy5fcmVjb25uZWN0aW5nICYmXG4gICAgICAgICAgICB0aGlzLl9yZWNvbm5lY3Rpb24gJiZcbiAgICAgICAgICAgIHRoaXMuYmFja29mZi5hdHRlbXB0cyA9PT0gMCkge1xuICAgICAgICAgICAgLy8ga2VlcHMgcmVjb25uZWN0aW9uIGZyb20gZmlyaW5nIHR3aWNlIGZvciB0aGUgc2FtZSByZWNvbm5lY3Rpb24gbG9vcFxuICAgICAgICAgICAgdGhpcy5yZWNvbm5lY3QoKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICAvKipcbiAgICAgKiBTZXRzIHRoZSBjdXJyZW50IHRyYW5zcG9ydCBgc29ja2V0YC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIC0gb3B0aW9uYWwsIGNhbGxiYWNrXG4gICAgICogQHJldHVybiBzZWxmXG4gICAgICogQHB1YmxpY1xuICAgICAqL1xuICAgIG9wZW4oZm4pIHtcbiAgICAgICAgaWYgKH50aGlzLl9yZWFkeVN0YXRlLmluZGV4T2YoXCJvcGVuXCIpKVxuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIHRoaXMuZW5naW5lID0gbmV3IEVuZ2luZSh0aGlzLnVyaSwgdGhpcy5vcHRzKTtcbiAgICAgICAgY29uc3Qgc29ja2V0ID0gdGhpcy5lbmdpbmU7XG4gICAgICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgICAgICB0aGlzLl9yZWFkeVN0YXRlID0gXCJvcGVuaW5nXCI7XG4gICAgICAgIHRoaXMuc2tpcFJlY29ubmVjdCA9IGZhbHNlO1xuICAgICAgICAvLyBlbWl0IGBvcGVuYFxuICAgICAgICBjb25zdCBvcGVuU3ViRGVzdHJveSA9IG9uKHNvY2tldCwgXCJvcGVuXCIsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHNlbGYub25vcGVuKCk7XG4gICAgICAgICAgICBmbiAmJiBmbigpO1xuICAgICAgICB9KTtcbiAgICAgICAgY29uc3Qgb25FcnJvciA9IChlcnIpID0+IHtcbiAgICAgICAgICAgIHRoaXMuY2xlYW51cCgpO1xuICAgICAgICAgICAgdGhpcy5fcmVhZHlTdGF0ZSA9IFwiY2xvc2VkXCI7XG4gICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcImVycm9yXCIsIGVycik7XG4gICAgICAgICAgICBpZiAoZm4pIHtcbiAgICAgICAgICAgICAgICBmbihlcnIpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gT25seSBkbyB0aGlzIGlmIHRoZXJlIGlzIG5vIGZuIHRvIGhhbmRsZSB0aGUgZXJyb3JcbiAgICAgICAgICAgICAgICB0aGlzLm1heWJlUmVjb25uZWN0T25PcGVuKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIC8vIGVtaXQgYGVycm9yYFxuICAgICAgICBjb25zdCBlcnJvclN1YiA9IG9uKHNvY2tldCwgXCJlcnJvclwiLCBvbkVycm9yKTtcbiAgICAgICAgaWYgKGZhbHNlICE9PSB0aGlzLl90aW1lb3V0KSB7XG4gICAgICAgICAgICBjb25zdCB0aW1lb3V0ID0gdGhpcy5fdGltZW91dDtcbiAgICAgICAgICAgIC8vIHNldCB0aW1lclxuICAgICAgICAgICAgY29uc3QgdGltZXIgPSB0aGlzLnNldFRpbWVvdXRGbigoKSA9PiB7XG4gICAgICAgICAgICAgICAgb3BlblN1YkRlc3Ryb3koKTtcbiAgICAgICAgICAgICAgICBvbkVycm9yKG5ldyBFcnJvcihcInRpbWVvdXRcIikpO1xuICAgICAgICAgICAgICAgIHNvY2tldC5jbG9zZSgpO1xuICAgICAgICAgICAgfSwgdGltZW91dCk7XG4gICAgICAgICAgICBpZiAodGhpcy5vcHRzLmF1dG9VbnJlZikge1xuICAgICAgICAgICAgICAgIHRpbWVyLnVucmVmKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLnN1YnMucHVzaCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5jbGVhclRpbWVvdXRGbih0aW1lcik7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnN1YnMucHVzaChvcGVuU3ViRGVzdHJveSk7XG4gICAgICAgIHRoaXMuc3Vicy5wdXNoKGVycm9yU3ViKTtcbiAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEFsaWFzIGZvciBvcGVuKClcbiAgICAgKlxuICAgICAqIEByZXR1cm4gc2VsZlxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBjb25uZWN0KGZuKSB7XG4gICAgICAgIHJldHVybiB0aGlzLm9wZW4oZm4pO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiB0cmFuc3BvcnQgb3Blbi5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgb25vcGVuKCkge1xuICAgICAgICAvLyBjbGVhciBvbGQgc3Vic1xuICAgICAgICB0aGlzLmNsZWFudXAoKTtcbiAgICAgICAgLy8gbWFyayBhcyBvcGVuXG4gICAgICAgIHRoaXMuX3JlYWR5U3RhdGUgPSBcIm9wZW5cIjtcbiAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJvcGVuXCIpO1xuICAgICAgICAvLyBhZGQgbmV3IHN1YnNcbiAgICAgICAgY29uc3Qgc29ja2V0ID0gdGhpcy5lbmdpbmU7XG4gICAgICAgIHRoaXMuc3Vicy5wdXNoKG9uKHNvY2tldCwgXCJwaW5nXCIsIHRoaXMub25waW5nLmJpbmQodGhpcykpLCBvbihzb2NrZXQsIFwiZGF0YVwiLCB0aGlzLm9uZGF0YS5iaW5kKHRoaXMpKSwgb24oc29ja2V0LCBcImVycm9yXCIsIHRoaXMub25lcnJvci5iaW5kKHRoaXMpKSwgb24oc29ja2V0LCBcImNsb3NlXCIsIHRoaXMub25jbG9zZS5iaW5kKHRoaXMpKSwgb24odGhpcy5kZWNvZGVyLCBcImRlY29kZWRcIiwgdGhpcy5vbmRlY29kZWQuYmluZCh0aGlzKSkpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgdXBvbiBhIHBpbmcuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9ucGluZygpIHtcbiAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJwaW5nXCIpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDYWxsZWQgd2l0aCBkYXRhLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbmRhdGEoZGF0YSkge1xuICAgICAgICB0cnkge1xuICAgICAgICAgICAgdGhpcy5kZWNvZGVyLmFkZChkYXRhKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaCAoZSkge1xuICAgICAgICAgICAgdGhpcy5vbmNsb3NlKFwicGFyc2UgZXJyb3JcIiwgZSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHdoZW4gcGFyc2VyIGZ1bGx5IGRlY29kZXMgYSBwYWNrZXQuXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIG9uZGVjb2RlZChwYWNrZXQpIHtcbiAgICAgICAgLy8gdGhlIG5leHRUaWNrIGNhbGwgcHJldmVudHMgYW4gZXhjZXB0aW9uIGluIGEgdXNlci1wcm92aWRlZCBldmVudCBsaXN0ZW5lciBmcm9tIHRyaWdnZXJpbmcgYSBkaXNjb25uZWN0aW9uIGR1ZSB0byBhIFwicGFyc2UgZXJyb3JcIlxuICAgICAgICBuZXh0VGljaygoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInBhY2tldFwiLCBwYWNrZXQpO1xuICAgICAgICB9LCB0aGlzLnNldFRpbWVvdXRGbik7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB1cG9uIHNvY2tldCBlcnJvci5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgb25lcnJvcihlcnIpIHtcbiAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJlcnJvclwiLCBlcnIpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGEgbmV3IHNvY2tldCBmb3IgdGhlIGdpdmVuIGBuc3BgLlxuICAgICAqXG4gICAgICogQHJldHVybiB7U29ja2V0fVxuICAgICAqIEBwdWJsaWNcbiAgICAgKi9cbiAgICBzb2NrZXQobnNwLCBvcHRzKSB7XG4gICAgICAgIGxldCBzb2NrZXQgPSB0aGlzLm5zcHNbbnNwXTtcbiAgICAgICAgaWYgKCFzb2NrZXQpIHtcbiAgICAgICAgICAgIHNvY2tldCA9IG5ldyBTb2NrZXQodGhpcywgbnNwLCBvcHRzKTtcbiAgICAgICAgICAgIHRoaXMubnNwc1tuc3BdID0gc29ja2V0O1xuICAgICAgICB9XG4gICAgICAgIGVsc2UgaWYgKHRoaXMuX2F1dG9Db25uZWN0ICYmICFzb2NrZXQuYWN0aXZlKSB7XG4gICAgICAgICAgICBzb2NrZXQuY29ubmVjdCgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBzb2NrZXQ7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB1cG9uIGEgc29ja2V0IGNsb3NlLlxuICAgICAqXG4gICAgICogQHBhcmFtIHNvY2tldFxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgX2Rlc3Ryb3koc29ja2V0KSB7XG4gICAgICAgIGNvbnN0IG5zcHMgPSBPYmplY3Qua2V5cyh0aGlzLm5zcHMpO1xuICAgICAgICBmb3IgKGNvbnN0IG5zcCBvZiBuc3BzKSB7XG4gICAgICAgICAgICBjb25zdCBzb2NrZXQgPSB0aGlzLm5zcHNbbnNwXTtcbiAgICAgICAgICAgIGlmIChzb2NrZXQuYWN0aXZlKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2Nsb3NlKCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIFdyaXRlcyBhIHBhY2tldC5cbiAgICAgKlxuICAgICAqIEBwYXJhbSBwYWNrZXRcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIF9wYWNrZXQocGFja2V0KSB7XG4gICAgICAgIGNvbnN0IGVuY29kZWRQYWNrZXRzID0gdGhpcy5lbmNvZGVyLmVuY29kZShwYWNrZXQpO1xuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGVuY29kZWRQYWNrZXRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICB0aGlzLmVuZ2luZS53cml0ZShlbmNvZGVkUGFja2V0c1tpXSwgcGFja2V0Lm9wdGlvbnMpO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENsZWFuIHVwIHRyYW5zcG9ydCBzdWJzY3JpcHRpb25zIGFuZCBwYWNrZXQgYnVmZmVyLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBjbGVhbnVwKCkge1xuICAgICAgICB0aGlzLnN1YnMuZm9yRWFjaCgoc3ViRGVzdHJveSkgPT4gc3ViRGVzdHJveSgpKTtcbiAgICAgICAgdGhpcy5zdWJzLmxlbmd0aCA9IDA7XG4gICAgICAgIHRoaXMuZGVjb2Rlci5kZXN0cm95KCk7XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENsb3NlIHRoZSBjdXJyZW50IHNvY2tldC5cbiAgICAgKlxuICAgICAqIEBwcml2YXRlXG4gICAgICovXG4gICAgX2Nsb3NlKCkge1xuICAgICAgICB0aGlzLnNraXBSZWNvbm5lY3QgPSB0cnVlO1xuICAgICAgICB0aGlzLl9yZWNvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5vbmNsb3NlKFwiZm9yY2VkIGNsb3NlXCIpO1xuICAgICAgICBpZiAodGhpcy5lbmdpbmUpXG4gICAgICAgICAgICB0aGlzLmVuZ2luZS5jbG9zZSgpO1xuICAgIH1cbiAgICAvKipcbiAgICAgKiBBbGlhcyBmb3IgY2xvc2UoKVxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBkaXNjb25uZWN0KCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fY2xvc2UoKTtcbiAgICB9XG4gICAgLyoqXG4gICAgICogQ2FsbGVkIHVwb24gZW5naW5lIGNsb3NlLlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbmNsb3NlKHJlYXNvbiwgZGVzY3JpcHRpb24pIHtcbiAgICAgICAgdGhpcy5jbGVhbnVwKCk7XG4gICAgICAgIHRoaXMuYmFja29mZi5yZXNldCgpO1xuICAgICAgICB0aGlzLl9yZWFkeVN0YXRlID0gXCJjbG9zZWRcIjtcbiAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJjbG9zZVwiLCByZWFzb24sIGRlc2NyaXB0aW9uKTtcbiAgICAgICAgaWYgKHRoaXMuX3JlY29ubmVjdGlvbiAmJiAhdGhpcy5za2lwUmVjb25uZWN0KSB7XG4gICAgICAgICAgICB0aGlzLnJlY29ubmVjdCgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIEF0dGVtcHQgYSByZWNvbm5lY3Rpb24uXG4gICAgICpcbiAgICAgKiBAcHJpdmF0ZVxuICAgICAqL1xuICAgIHJlY29ubmVjdCgpIHtcbiAgICAgICAgaWYgKHRoaXMuX3JlY29ubmVjdGluZyB8fCB0aGlzLnNraXBSZWNvbm5lY3QpXG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgICAgIGlmICh0aGlzLmJhY2tvZmYuYXR0ZW1wdHMgPj0gdGhpcy5fcmVjb25uZWN0aW9uQXR0ZW1wdHMpIHtcbiAgICAgICAgICAgIHRoaXMuYmFja29mZi5yZXNldCgpO1xuICAgICAgICAgICAgdGhpcy5lbWl0UmVzZXJ2ZWQoXCJyZWNvbm5lY3RfZmFpbGVkXCIpO1xuICAgICAgICAgICAgdGhpcy5fcmVjb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBkZWxheSA9IHRoaXMuYmFja29mZi5kdXJhdGlvbigpO1xuICAgICAgICAgICAgdGhpcy5fcmVjb25uZWN0aW5nID0gdHJ1ZTtcbiAgICAgICAgICAgIGNvbnN0IHRpbWVyID0gdGhpcy5zZXRUaW1lb3V0Rm4oKCkgPT4ge1xuICAgICAgICAgICAgICAgIGlmIChzZWxmLnNraXBSZWNvbm5lY3QpXG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInJlY29ubmVjdF9hdHRlbXB0XCIsIHNlbGYuYmFja29mZi5hdHRlbXB0cyk7XG4gICAgICAgICAgICAgICAgLy8gY2hlY2sgYWdhaW4gZm9yIHRoZSBjYXNlIHNvY2tldCBjbG9zZWQgaW4gYWJvdmUgZXZlbnRzXG4gICAgICAgICAgICAgICAgaWYgKHNlbGYuc2tpcFJlY29ubmVjdClcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIHNlbGYub3BlbigoZXJyKSA9PiB7XG4gICAgICAgICAgICAgICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlbGYuX3JlY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgICAgICAgICAgICAgc2VsZi5yZWNvbm5lY3QoKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuZW1pdFJlc2VydmVkKFwicmVjb25uZWN0X2Vycm9yXCIsIGVycik7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZWxmLm9ucmVjb25uZWN0KCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH0sIGRlbGF5KTtcbiAgICAgICAgICAgIGlmICh0aGlzLm9wdHMuYXV0b1VucmVmKSB7XG4gICAgICAgICAgICAgICAgdGltZXIudW5yZWYoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuc3Vicy5wdXNoKCgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNsZWFyVGltZW91dEZuKHRpbWVyKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuICAgIC8qKlxuICAgICAqIENhbGxlZCB1cG9uIHN1Y2Nlc3NmdWwgcmVjb25uZWN0LlxuICAgICAqXG4gICAgICogQHByaXZhdGVcbiAgICAgKi9cbiAgICBvbnJlY29ubmVjdCgpIHtcbiAgICAgICAgY29uc3QgYXR0ZW1wdCA9IHRoaXMuYmFja29mZi5hdHRlbXB0cztcbiAgICAgICAgdGhpcy5fcmVjb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuYmFja29mZi5yZXNldCgpO1xuICAgICAgICB0aGlzLmVtaXRSZXNlcnZlZChcInJlY29ubmVjdFwiLCBhdHRlbXB0KTtcbiAgICB9XG59XG4iLCJpbXBvcnQgeyB1cmwgfSBmcm9tIFwiLi91cmwuanNcIjtcbmltcG9ydCB7IE1hbmFnZXIgfSBmcm9tIFwiLi9tYW5hZ2VyLmpzXCI7XG5pbXBvcnQgeyBTb2NrZXQgfSBmcm9tIFwiLi9zb2NrZXQuanNcIjtcbi8qKlxuICogTWFuYWdlcnMgY2FjaGUuXG4gKi9cbmNvbnN0IGNhY2hlID0ge307XG5mdW5jdGlvbiBsb29rdXAodXJpLCBvcHRzKSB7XG4gICAgaWYgKHR5cGVvZiB1cmkgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgICAgb3B0cyA9IHVyaTtcbiAgICAgICAgdXJpID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBvcHRzID0gb3B0cyB8fCB7fTtcbiAgICBjb25zdCBwYXJzZWQgPSB1cmwodXJpLCBvcHRzLnBhdGggfHwgXCIvc29ja2V0LmlvXCIpO1xuICAgIGNvbnN0IHNvdXJjZSA9IHBhcnNlZC5zb3VyY2U7XG4gICAgY29uc3QgaWQgPSBwYXJzZWQuaWQ7XG4gICAgY29uc3QgcGF0aCA9IHBhcnNlZC5wYXRoO1xuICAgIGNvbnN0IHNhbWVOYW1lc3BhY2UgPSBjYWNoZVtpZF0gJiYgcGF0aCBpbiBjYWNoZVtpZF1bXCJuc3BzXCJdO1xuICAgIGNvbnN0IG5ld0Nvbm5lY3Rpb24gPSBvcHRzLmZvcmNlTmV3IHx8XG4gICAgICAgIG9wdHNbXCJmb3JjZSBuZXcgY29ubmVjdGlvblwiXSB8fFxuICAgICAgICBmYWxzZSA9PT0gb3B0cy5tdWx0aXBsZXggfHxcbiAgICAgICAgc2FtZU5hbWVzcGFjZTtcbiAgICBsZXQgaW87XG4gICAgaWYgKG5ld0Nvbm5lY3Rpb24pIHtcbiAgICAgICAgaW8gPSBuZXcgTWFuYWdlcihzb3VyY2UsIG9wdHMpO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgICAgaWYgKCFjYWNoZVtpZF0pIHtcbiAgICAgICAgICAgIGNhY2hlW2lkXSA9IG5ldyBNYW5hZ2VyKHNvdXJjZSwgb3B0cyk7XG4gICAgICAgIH1cbiAgICAgICAgaW8gPSBjYWNoZVtpZF07XG4gICAgfVxuICAgIGlmIChwYXJzZWQucXVlcnkgJiYgIW9wdHMucXVlcnkpIHtcbiAgICAgICAgb3B0cy5xdWVyeSA9IHBhcnNlZC5xdWVyeUtleTtcbiAgICB9XG4gICAgcmV0dXJuIGlvLnNvY2tldChwYXJzZWQucGF0aCwgb3B0cyk7XG59XG4vLyBzbyB0aGF0IFwibG9va3VwXCIgY2FuIGJlIHVzZWQgYm90aCBhcyBhIGZ1bmN0aW9uIChlLmcuIGBpbyguLi4pYCkgYW5kIGFzIGFcbi8vIG5hbWVzcGFjZSAoZS5nLiBgaW8uY29ubmVjdCguLi4pYCksIGZvciBiYWNrd2FyZCBjb21wYXRpYmlsaXR5XG5PYmplY3QuYXNzaWduKGxvb2t1cCwge1xuICAgIE1hbmFnZXIsXG4gICAgU29ja2V0LFxuICAgIGlvOiBsb29rdXAsXG4gICAgY29ubmVjdDogbG9va3VwLFxufSk7XG4vKipcbiAqIFByb3RvY29sIHZlcnNpb24uXG4gKlxuICogQHB1YmxpY1xuICovXG5leHBvcnQgeyBwcm90b2NvbCB9IGZyb20gXCJzb2NrZXQuaW8tcGFyc2VyXCI7XG4vKipcbiAqIEV4cG9zZSBjb25zdHJ1Y3RvcnMgZm9yIHN0YW5kYWxvbmUgYnVpbGQuXG4gKlxuICogQHB1YmxpY1xuICovXG5leHBvcnQgeyBNYW5hZ2VyLCBTb2NrZXQsIGxvb2t1cCBhcyBpbywgbG9va3VwIGFzIGNvbm5lY3QsIGxvb2t1cCBhcyBkZWZhdWx0LCB9O1xuIiwiaW1wb3J0IHsgaW8gfSBmcm9tIFwic29ja2V0LmlvLWNsaWVudFwiO1xyXG5cclxud2luZG93LnNvY2tldCA9IGlvKCk7XHJcblxyXG5hc3luYyBmdW5jdGlvbiBtYWluQ2xpZW50KCkge1xyXG4gICAgd2luZG93LnNvY2tldC5vbihcImNvbm5lY3RcIiwgKCkgPT4ge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKHdpbmRvdy5zb2NrZXQuaWQpO1xyXG4gICAgfSk7XHJcbn1cclxuICBcclxud2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJsb2FkXCIsIChldmVudCkgPT4ge1xyXG4gICAgbWFpbkNsaWVudCgpO1xyXG4gICAgLypuYXZpZ2F0b3IuZ2VvbG9jYXRpb24uZ2V0Q3VycmVudFBvc2l0aW9uKChzKSA9PiB7XHJcbiAgICAgICAgYWxlcnQocy5jb29yZHMubGF0aXR1ZGUpO1xyXG4gICAgfSk7Ki9cclxuXHJcbiAgICBkb2N1bWVudC5nZXRFbGVtZW50QnlJZChcImJ0blwiKS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgIHdpbmRvdy5sb2NhdGlvbi5ocmVmID0gXCIvbG9naW5cIjtcclxuICAgIH0pO1xyXG59KTsiXSwibmFtZXMiOlsid2l0aE5hdGl2ZUJsb2IiLCJ3aXRoTmF0aXZlQXJyYXlCdWZmZXIiLCJpc1ZpZXciLCJsb29rdXAiLCJkZWNvZGUiLCJwcm90b2NvbCIsImdsb2JhbFRoaXMiLCJlbmNvZGUiLCJYTUxIdHRwUmVxdWVzdCIsIlNvY2tldCIsIlJFU0VSVkVEX0VWRU5UUyIsIkVuZ2luZSIsImlvIl0sIm1hcHBpbmdzIjoiOzs7SUFBQSxNQUFNLFlBQVksR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ3pDLFlBQVksQ0FBQyxNQUFNLENBQUMsR0FBRyxHQUFHLENBQUM7SUFDM0IsWUFBWSxDQUFDLE9BQU8sQ0FBQyxHQUFHLEdBQUcsQ0FBQztJQUM1QixZQUFZLENBQUMsTUFBTSxDQUFDLEdBQUcsR0FBRyxDQUFDO0lBQzNCLFlBQVksQ0FBQyxNQUFNLENBQUMsR0FBRyxHQUFHLENBQUM7SUFDM0IsWUFBWSxDQUFDLFNBQVMsQ0FBQyxHQUFHLEdBQUcsQ0FBQztJQUM5QixZQUFZLENBQUMsU0FBUyxDQUFDLEdBQUcsR0FBRyxDQUFDO0lBQzlCLFlBQVksQ0FBQyxNQUFNLENBQUMsR0FBRyxHQUFHLENBQUM7SUFDM0IsTUFBTSxvQkFBb0IsR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2pELE1BQU0sQ0FBQyxJQUFJLENBQUMsWUFBWSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsR0FBRyxLQUFLO0lBQzNDLElBQUksb0JBQW9CLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsR0FBRyxDQUFDO0lBQ2xELENBQUMsQ0FBQyxDQUFDO0lBQ0gsTUFBTSxZQUFZLEdBQUcsRUFBRSxJQUFJLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxjQUFjLEVBQUU7O0lDWDVELE1BQU1BLGdCQUFjLEdBQUcsT0FBTyxJQUFJLEtBQUssVUFBVTtJQUNqRCxLQUFL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Q0E7SUFDQTtJQUNBO0lBQ0E7SUFDQTtJQUNBO0lBQ0E7SUFDQTtJQUNBLE1BQU0sRUFBRSxHQUFHLHFQQUFxUCxDQUFDO0lBQ2pRLE1BQU0sS0FBSyxHQUFHO0lBQ2QsSUFBSSxRQUFRLEVBQUUsVUFBVSxFQUFFLFdBQVcsRUFBRSxVQUFVLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLFVBQVUsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUUsUUFBUTtJQUNqSixDQUFDLENBQUM7SUFDSyxTQUFTLEtBQUssQ0FBQyxHQUFHLEVBQUU7SUFDM0IsSUFBSSxJQUFJLEdBQUcsQ0FBQyxNQUFNLEdBQUcsSUFBSSxFQUFFO0lBQzNCLFFBQVEsTUFBTSxjQUFjLENBQUM7SUFDN0IsS0FBSztJQUNMLElBQUksTUFBTSxHQUFHLEdBQUcsR0FBRyxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxHQUFHLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ2hFLElBQUksSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFO0lBQzVCLFFBQVEsR0FBRyxHQUFHLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxHQUFHLEdBQUcsQ0FBQyxTQUFTLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDLE9BQU8sQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLEdBQUcsR0FBRyxDQUFDLFNBQVMsQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQzFHLEtBQUs7SUFDTCxJQUFJLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQyxJQUFJLENBQUMsR0FBRyxJQUFJLEVBQUUsQ0FBQyxFQUFFLEdBQUcsR0FBRyxFQUFFLEVBQUUsQ0FBQyxHQUFHLEVBQUUsQ0FBQztJQUNqRCxJQUFJLE9BQU8sQ0FBQyxF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LEVBQUUsR0FBRyxJQUFJLE9BQU8sQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDdkMsS0FBSztJQUNMLFNBQVM7SUFDVCxRQUFRLElBQUksQ0FBQyxLQUFLLENBQUMsRUFBRSxDQUFDLEVBQUU7SUFDeEIsWUFBWSxLQUFLLENBQUMsRUFBRSxDQUFDLEdBQUcsSUFBSSxPQUFPLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQ2xELFNBQVM7SUFDVCxRQUFRLEVBQUUsR0FBRyxLQUFLLENBQUMsRUFBRSxDQUFDLENBQUM7SUFDdkIsS0FBSztJQUNMLElBQUksSUFBSSxNQUFNLENBQUMsS0FBSyxJQUFJLENBQUMsSUFBSSxDQUFDLEtBQUssRUFBRTtJQUNyQyxRQUFRLElBQUksQ0FBQyxLQUFLLEdBQUcsTUFBTSxDQUFDLFFBQVEsQ0FBQztJQUNyQyxLQUFLO0lBQ0wsSUFBSSxPQUFPLEVBQUUsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztJQUN4QyxDQUFDO0lBQ0Q7SUFDQTtJQUNBLE1BQU0sQ0FBQyxNQUFNLENBQUMsTUFBTSxFQUFFO0lBQ3RCLElBQUksT0FBTztJQUNYLElBQUksTUFBTTtJQUNWLElBQUksRUFBRSxFQUFFLE1BQU07SUFDZCxJQUFJLE9BQU8sRUFBRSxNQUFNO0lBQ25CLENBQUMsQ0FBQzs7SUMxQ0YsTUFBTSxDQUFDLE1BQU0sR0FBR0MsTUFBRSxFQUFFLENBQUM7QUFDckI7SUFDQSxlQUFlLFVBQVUsR0FBRztJQUM1QixJQUFJLE1BQU0sQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLFNBQVMsRUFBRSxNQUFNO0lBQ3RDLFFBQVEsT0FBTyxDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxDQUFDO0lBQ3RDLEtBQUssQ0FBQyxDQUFDO0lBQ1AsQ0FBQztJQUNEO0lBQ0EsTUFBTSxDQUFDLGdCQUFnQixDQUFDLE1BQU0sRUFBRSxDQUFDLEtBQUssS0FBSztJQUMzQyxJQUFJLFVBQVUsRUFBRSxDQUFDO0lBQ2pCO0lBQ0E7SUFDQTtBQUNBO0lBQ0EsSUFBSSxRQUFRLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxDQUFDLGdCQUFnQixDQUFDLE9BQU8sRUFBRSxNQUFNO0lBQ25FLFFBQVEsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEdBQUcsUUFBUSxDQUFDO0lBQ3hDLEtBQUssQ0FBQyxDQUFDO0lBQ1AsQ0FBQyxDQUFDOzs7Ozs7IiwieF9nb29nbGVfaWdub3JlTGlzdCI6WzAsMSwyLDMsNCw1LDYsNyw4LDksMTAsMTEsMTIsMTMsMTQsMTUsMTYsMTcsMTgsMTksMjAsMjEsMjIsMjMsMjQsMjUsMjYsMjcsMjhdfQ==
