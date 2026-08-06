/**
 * Async Beanstalk
 *
 * Copyright (c) Zebra North, 2026
 */

import { EventEmitter } from 'node:events';
import { Socket } from 'node:net';
import { setTimeout } from 'node:timers';

/**
 * Handle the socket connection to the Beanstalk server.
 *
 * Events:
 *
 * - error: Emitted when a socket error occurs.
 * - close: Emitted when the connection is closed.
 *
 * @internal
 */
export class Connection extends EventEmitter {
    private socket: Socket | null = null;

    /**
     * Data received from the server but not yet processed.
     */
    private readBuffer = '';

    /**
     * The maximum number of milliseconds to wait when reading from the server.
     */
    private readTimeoutMs: number;

    /**
     * Create a connection.
     *
     * @param readTimeoutMs - The maximum number of milliseconds to wait when reading from the server.
     */
    public constructor(readTimeoutMs: number) {
        super();
        this.readTimeoutMs = readTimeoutMs;
    }

    /**
     * Open a connection to the server.
     *
     * @param host - The hostname or IP address.
     * @param port - The TCP/IP prt number.
     *
     * @returns Returns a promise that resolves when the connection has been successfully established.
     *
     * @throws
     * Throws if the connection is already open.
     */
    public async open(host: string, port: number): Promise<void> {
        if (this.socket) {
            throw new Error("Connection is already open");
        }

        this.socket = new Socket;
        this.socket.setNoDelay(true);
        this.socket.setKeepAlive(true);
        this.socket.setDefaultEncoding('utf-8');
        this.readBuffer = '';

        return new Promise<void>((resolve, reject) => {
            const onError = (err: Error) => {
                this.socket = null;
                reject(err);
            };

            const onSuccess = () => {
                if (!this.socket) {
                    reject(new Error('Connection closed while connecting'));
                    return;
                }

                this.socket.off('error', onError);
                this.socket.on('error', (e) => { this.socket = null; this.emit('error', e); });
                this.socket.on('close', () => { this.socket = null; this.emit('close'); });
                this.socket.on('data', this.onData.bind(this));

                resolve();
            };

            this.socket?.once('error', onError);
            this.socket?.connect(port, host, onSuccess);
        });
    }

    /**
     * Close the connection to the server.
     *
     * The socket is no longer writable once this function is called, however data may still
     * be received until the promise returned by the function is resolved.
     */
    public async close() {
        if (!this.socket) {
            return;
        }

        const onClosed = (resolve: () => void): void => {
            this.socket = null;
            resolve();
        };

        return new Promise<void>((resolve) => this.socket?.end(() => onClosed(resolve)));
    }

    /**
     * Send data.
     *
     * @param data - The UTF-8 encoded string data to send.
     *
     * @throws
     * Throws if the socket is not connected.
     */
    public write(data: string): void {
        if (!this.socket) {
            throw new Error('Not connected');
        }

        this.socket.write(data);
    }

    /**
     * Read a line of text from the server.
     *
     * Reads until the first \\r\\n.  The \\r\\n is stripped from the return value.
     *
     * @returns Returns the text read from the server.
     */
    public async readLine(): Promise<string> {
        while (true) {
            const newlinePosition = this.readBuffer.indexOf("\r\n");

            if (newlinePosition === -1) {
                // Wait for more data to arrive.
                await this.waitForData();
            } else {
                const result = this.readBuffer.substring(0, newlinePosition);
                this.readBuffer = this.readBuffer.substring(newlinePosition + 2);

                return result;
            }
        }
    }

    /**
     * Read a specified number of bytes from the server.
     *
     * The Beanstalk server will return this many bytes, plus a trailing \\r\\n.
     * The \\r\\n should not be counted in the number of bytes, nor will it be
     * present in the return value.
     *
     * @param bytes - The number of bytes to read.
     *
     * @returns Returns the data from the server.
     */
    public async readBytes(bytes: number): Promise<string> {
        while (true) {
            const length = this.readBuffer.length;

            if (length < bytes + 2) {
                // Wait for more data to arrive.
                await this.waitForData();
            } else {
                const result = this.readBuffer.substring(0, bytes);
                this.readBuffer = this.readBuffer.substring(bytes + 2);

                return result;
            }
        }
    }

    /**
     * The event handler for receiving data from the socket.
     *
     * @param data - The data received.
     */
    private onData(data: Buffer | string): void {
        // Append the data to the read buffer.
        this.readBuffer += data.toString();

        // Notify waitForData() that data is available.
        this.emit('data');
    }

    /**
     * Wait for data to be available in the read buffer.
     *
     * @returns Returns a promise that is resolved when `readBuffer` has new data.
     */
    private async waitForData(): Promise<void> {
        if (!this.socket) {
            throw new Error('Not connected');
        }

        const readPromise = new Promise<void>((resolve, reject) => {
            // Resolve when new data is available from the socket.
            const onSuccess = () => { removeHandlers(); resolve(); };

            // Reject if an error occurs.
            const onError = (e: Error) => { removeHandlers(); reject(e); };

            // Reject if the socket is closed.
            const onClose = () => { removeHandlers(); reject(new Error('Socket closed')); };

            // Clean up the event handlers.
            const removeHandlers = () => {
                this.off('data', onSuccess);
                this.off('error', onError);
                this.off('close', onClose);
            };

            // Bind handlers for events that may occur while waiting for data.
            this.once('data', onSuccess);
            this.once('error', onError);
            this.once('close', onClose);
        });

        await this.awaitWithTimeout(readPromise, this.readTimeoutMs);
    }

    /**
     * Add a timeout to a promise.
     *
     * @param task - The promise to run with a timeout.
     *
     * @returns Returns the task promise.
     *
     * @throws
     * Throws if the task times out.
     */
    private async awaitWithTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
        // Create a sentinal value for identifying if the timeout promise resolved first.
        const timedOut = {};
        let timer: ReturnType<typeof setTimeout> | undefined;
        let resolveTimeout = (o: object) => { void o; };

        // Create a promise that resolves after the timeout is reached.
        const timeoutPromise = new Promise<object>(resolve => {
            resolveTimeout = resolve;
            timer = setTimeout(() => resolve(timedOut), timeoutMs);
        });

        // Run the task and timeout in parallel.
        const result = await Promise.race([task, timeoutPromise]);

        // Throw if the timeout promise resoleved first.
        if (result === timedOut) {
            throw new Error('Operation timed out');
        }

        // Cancel the timer.
        clearTimeout(timer);

        // Resolve the promise so that it doesn't cause a memory leak.
        resolveTimeout(timedOut);

        return result as Awaited<T>;
    }
};
