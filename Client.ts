/**
 * Async Beanstalk
 *
 * Copyright (c) Zebra North, 2026
 */

import { Connection } from './Connection.ts';
import assert from 'node:assert/strict';

/**
 * A job received from Beanstalk.
 *
 * @public
 */
export type Job = {
    /**
     * The Beanstalk server's ID for the job.
     */
    id: number,

    /**
     * The raw job data.
     */
    payload: string
};

/**
 * A key/value store of statistics from the server.
 *
 * @public
 */
export type Yaml = Map<string, string | number>;

/**
 * Thrown as an exception when a command fails.
 * 
 * @public
 */
export class BeanstalkError extends Error {
};

/**
 * Thrown as an exception when the server runs out of memory
 * during a {@link Client.put} operation.
 * 
 * @public
 */
export class JobBuried extends BeanstalkError {
    /**
     * The ID of the job that was buried.
     */
    public jobId = 0;
};

/**
 * The Client connects to the Beanstalk server and allows you to
 * send commands and receive responses.
 *
 * @public
 */
export class Client {
    /**
     * The socket connection to the server.
     */
    private connection: Connection;

    /**
     * A FIFO queue of commands that have been sent to the server and are awaiting a response.
     */
    private tasks: (() => Promise<void>)[] = [];

    /**
     * Create the client.
     * 
     * The optional readTimeoutMs parameter allows you to specify how long the client will wait for data
     * from the Beanstalk server before timing out.
     * 
     * This should be greater than the maximum time spent waiting for a job with "reserve()" or "reserveWithTimeout()".
     *
     * @param readTimeoutMs - The maximum number of milliseconds to wait when reading from the server.
     */
    public constructor(readTimeoutMs = 600000) {
        this.connection = new Connection(readTimeoutMs);
    }

    /**
     * Connect to the Beanstalk server.
     * 
     * @param host - The server's hostname or IP address.
     * @param port - The TCP/IP port number.
     *
     * @returns Returns a promise that resolves when the connection is ready or rejects if connecting fails.
     */
    public async connect(host: string, port: number = 11300) {
        this.tasks = [];

        return this.connection.open(host, port);
    }

    /**
     * Set the tube into which new jobs will be placed.
     *
     * @param tube - The name of the tube.
     *
     * @returns Returns a promise that resolves when the command is complete.
     */
    public async use(tube: string): Promise<void> {
        return this.sendCommand(() => this.handleSimpleResponse('USING ' + tube), 'use ' + tube);
    }

    /**
     * Watch a tube for incoming jobs.
     *
     * After calling `watch()`, call `reserve()` to wait for a job to be ready.
     *
     * This may be called multiple times to watch multipe tubes at once.
     *
     * @see {@link ignore}
     *
     * @param tube - The name of the tube to watch.
     *
     * @returns Returns a promise that resolves to the number of tubes being watched.
     */
    public async watch(tube: string): Promise<number> {
        return this.sendCommand(() => this.handleNumericResponse('WATCHING'), 'watch ' + tube);
    }

    /**
     * Stop watching the given tube.
     *
     * @see {@link watch}
     *
     * @param tube - The tube to stop watching.
     *
     * @returns Returns a promise that resolves to the number of tubes being watched.
     */
    public async ignore(tube: string): Promise<number> {
        return this.sendCommand(() => this.handleNumericResponse('WATCHING'), 'ignore ' + tube);
    }

    /**
     * Inspect a specific job.
     *
     * @param jobId - The ID of the job to inspect.
     *
     * @returns Returns a promise that resolves to the job or null if there is none.
     */
    public async peek(jobId: number): Promise<Job | null> {
        return this.sendCommand(() => this.handleJobResponse('FOUND'), `peek ${jobId.toString()}`);
    }

    /**
     * Inspect the first ready job.
     *
     * @returns Returns a promise that resolves to the job or null if there is none.
     */
    public async peekReady(): Promise<Job | null> {
        return this.sendCommand(() => this.handleJobResponse('FOUND'), `peek-ready`);
    }

    /**
     * Inspect the first delayed job.
     *
     * @returns Returns a promise that resolves to the job or null if there is none.
     */
    public async peekDelayed(): Promise<Job | null> {
        return this.sendCommand(() => this.handleJobResponse('FOUND'), `peek-delayed`);
    }

    /**
     * Inspect the first buried job.
     *
     * @returns Returns a promise that resolves to the job or null if there is none.
     */
    public async peekBuried(): Promise<Job | null> {
        return this.sendCommand(() => this.handleJobResponse('FOUND'), `peek-buried`);
    }

    /**
     * Change buried or delayed jobs in the currently used queue to be ready.
     *
     * If there are any buried jobs then only buried jobs will be affected,
     * otherwise, only delayed jobs will be affected.
     *
     * @param max - The maximum number of jobs to alter.
     *
     * @returns Returns a promise that resolves to the number of jobs set to ready.
     */
    public async kick(max: number): Promise<number> {
        return this.sendCommand(() => this.handleNumericResponse('KICKED'), `kick ${max.toString()}`);
    }

    /**
     * Change a specific job from buried or delayed to ready.
     *
     * @param jobId - The ID of the job to modify.
     *
     * @returns Returns a promise that resolves when the job has been updated.
     *          Rejects with "NOT_FOUND" if there was no job with the given ID.
     */
    public async kickJob(jobId: number): Promise<void> {
        return this.sendCommand(() => this.handleSimpleResponse('KICKED'), `kick-job ${jobId.toString()}`);
    }

    /**
     * Fetch statistics about a specific job.
     *
     * @param jobId - The ID of the job to query.
     *
     * @returns Returns a promise that resolves to a map of data about the job.
     */
    public async statsJob(jobId: number): Promise<Yaml> {
        return this.sendCommand(() => this.handleYamlMapResponse(), `stats-job ${jobId.toString()}`);
    }

    /**
     * Fetch statistics about a tube.
     *
     * @param tube - The name of the tube to query.
     *
     * @returns Returns a promise that resolves to a map of data about the tube.
     */
    public async statsTube(tube: string): Promise<Yaml> {
        return this.sendCommand(() => this.handleYamlMapResponse(), `stats-tube ${tube}`);
    }

    /**
     * Fetch statistics about the server.
     *
     * @returns Returns a promise that resolves to a map of data about the server.
     */
    public async stats(): Promise<Yaml> {
        return this.sendCommand(() => this.handleYamlMapResponse(), `stats`);
    }

    /**
     * List all the tubes on the server.
     *
     * @returns Returns a promise that resolves to an array of tube names.
     */
    public async listTubes(): Promise<string[]> {
        return this.sendCommand(() => this.handleYamlListResponse(), `list-tubes`);
    }

    /**
     * List the tube currently being used by this client.
     *
     * @see {@link use}
     *
     * @returns Returns a promise that resolves to a tube name.
     */
    public async listTubeUsed(): Promise<string> {
        return this.sendCommand(async () => (await this.handleYamlListResponse())[0], `list-tube-used`);
    }

    /**
     * List the tubes currently being watched by this client.
     *
     * @see {@link watch}
     * @see {@link ignore}
     *
     * @returns Returns a promise that resolves to an array of tube names.
     */
    public async listTubesWatched(): Promise<string[]> {
        return this.sendCommand(() => this.handleYamlListResponse(), `list-tube-used`);
    }

    /**
     * Instruct the Beanstalk server to close the connection.
     *
     * Note that the Beanstlk server will close the connection immediately upon receiving this command.
     * It will not wait for the output from any previous commands to be sent.
     * You should therefore wait for any in-progress commands to be completed before issuing the quit command.
     *
     * @returns Returns a promise that resolves when the command is complete.
     */
    public async quit(): Promise<void> {
        return this.sendCommand(() => this.handleCloseResponse(), 'quit');
    }

    /**
     * Delay any new jobs from being reserved.
     *
     * @param tube  - The tube to pause.
     * @param delay - The number of seconds for which to pause.
     *
     * @returns Returns a promise that resolves when the command is complete.
     */
    public async pauseTube(tube: string, delay: number): Promise<void> {
        return this.sendCommand(() => this.handleSimpleResponse('PAUSED'), `pause-tube ${tube} ${delay.toString()}`);
    }

    /**
     * Add a job to the currently used queue.
     *
     * @see use
     *
     * @param job      - The job to enqueue.
     * @param priority - The integer job priority between 0 and 2^32-1. Jobs with lower priority values will be
     *                   reserved before jobs with higher priority values.
     * @param ttr      - The maximum number of seconds a job may be reserved for before being returned to the queue.
     * @param delay    - The number of seconds to wait between accepting the job and making it available to be reserved.
     *
     * @returns Returns a promise that resolves to the job ID.
     */
    public async put(job: string, priority: number = 1, ttr: number = 1000000000, delay: number = 0): Promise<number> {
        return this.sendCommand(() => this.handleNumericResponse('INSERTED'), `put ${priority.toString()} ${delay.toString()} ${ttr.toString()} ${job.length.toString()}\r\n${job}`);
    }

    /**
     * Delete a job from the queue.
     *
     * This should be called after reserving and successfully processing a job.
     *
     * @param jobId - The ID of the job to delete.
     *
     * @returns Returns a promise that resolves when the command is complete.
     */
    public async delete(jobId: number): Promise<void> {
        return this.sendCommand(() => this.handleSimpleResponse('DELETED'), 'delete ' + jobId.toString());
    }

    /**
     * Return the job to the "ready" state.
     *
     * This can be used to put a job back into the queue if processing fails.
     *
     * @param jobId    - The ID of the job to release.
     * @param priority - The job's new priority.
     * @param delay    - The number of seconds to wait before marking the job as ready.
     *
     * @returns Returns a promise that resolves when the command is complete.
     */
    public async release(jobId: number, priority: number = 1, delay: number = 0): Promise<void> {
        return this.sendCommand(() => this.handleSimpleResponse('RELEASED'), `release ${jobId.toString()} ${priority.toString()} ${delay.toString()}`);
    }

    /**
     * Put a job into the "buried" state.
     *
     * The job will remain in this state until released with the "kick" command.
     *
     * @see {@link kick}
     *
     * @param jobId    - The ID of the job to bury.
     * @param priority - The job's priority within the buried queue.
     *
     * @returns Returns a promise that resolves when the command is complete.
     */
    public async bury(jobId: number, priority: number = 1): Promise<void> {
        return this.sendCommand(() => this.handleSimpleResponse('BURIED'), `bury ${jobId.toString()} ${priority.toString()}`);
    }

    /**
     * Request more time working on a job.
     *
     * The job's time to
     *
     * @param jobId - The ID of the job to touch.
     *
     * @returns Returns a promise that resolves when the command is complete.
     */
    public async touch(jobId: number): Promise<void> {
        return this.sendCommand(() => this.handleSimpleResponse('TOUCHED'), `touch ${jobId.toString()}`);
    }

    /**
     * Read a job from the queue.
     *
     * @returns Returns a promise that resolves to the first job that was ready in any of the watched queues.
     */
    public async reserve(): Promise<Job> {
        const job = await this.sendCommand(() => this.handleJobResponse('RESERVED'), 'reserve');

        // Only reserveWithTimeout() should return null.
        assert(job !== null);

        return job;
    }

    /**
     * Read a job from the queue.
     *
     * @returns Returns a promise that resolves to the first job that was ready in any of the watched queues, or null
     *          if there were no jobs within the timeout.
     */
    public async reserveWithTimeout(timeout: number): Promise<Job | null> {
        return this.sendCommand(() => this.handleJobResponse('RESERVED'), 'reserve-with-timeout ' + timeout.toString());

    }

    /**
     * Send a query to the server and enqueue a task to read the result.
     *
     * @param handleResponse - Read and process the response from the server.
     *
     * @returns Returns a promise that resolves to the result from the server.
     */
    private async sendCommand<T>(handleResponse: () => Promise<T>, command: string): Promise<T> {
        // Create a function which when executed will run the task function and resolve the promise.
        const taskFinished = new Promise<T>((resolve, reject) => {
            const runTask = async () => {
                try {
                    // Wait for the task to complete and resolve the promise with its result.
                    resolve(await handleResponse());
                } catch (e) {
                    reject(new BeanstalkError(`Command "${command.split("\r\n")[0]}" failed due to "${String(e)}"`, { cause: e }));
                }

                // Remove the task from the queue.
                this.tasks.shift();

                // Start the next task, if there is one.
                if (this.tasks.length) {
                    // The "void" here indicates that we are purposefully not using 'await'.
                    void this.tasks[0]();
                }
            };

            this.tasks.push(runTask);

            // If there was nothing already running then begin the task now.
            if (this.tasks.length === 1) {
                // The "void" here indicates that we are purposefully not using 'await'.
                void runTask();
            }

            try {
                this.connection.write(command + "\r\n");
            } catch (e) {
                reject(new BeanstalkError(`Command "${command.split("\r\n")[0]}" failed to send due to "${String(e)}"`, { cause: e }));
            }
        });

        return taskFinished;
    }

    /**
     * Close the connection to the server.
     *
     * @returns Returns a promise that resolves when the connection is closed.
     */
    public async close() {
        return this.connection.close();
    }

    /**
     * Handle a response from the server that has zero parameters, e.g. just "OK".
     *
     * @param expected - The expected response.
     *
     * @returns Returns a promise that resolves when the command is complete.
     *
     * @throws {@link BeanstalkError}
     * Throws if the response does not match the expected response.
     */
    private handleSimpleResponse = async (expected: string): Promise<void> => {
        const data = await this.connection.readLine();

        if (data !== expected) {
            throw new BeanstalkError(data);
        }
    }

    /**
     * Handle a response from the server that has a single numeric parameter.
     *
     * @param expected - The expected response string.
     *
     * @returns Returns a promise that resolves to the numeric response from the server.
     *
     * @throws {@link BeanstalkError}
     * Throws if the response does not match the expected response.
     */
    private handleNumericResponse = async (expected: string): Promise<number> => {
        const data = (await this.connection.readLine()).split(' ');

        if (data[0] !== expected) {
            throw new BeanstalkError(data[0]);
        }

        return parseInt(data[1]);
    }

    /**
     * Handle a response from the server that contains arbitrary data.
     *
     * @param expected - The expected response string.
     *
     * @returns Returns a promise that resolves to the data from the server.
     *
     * @throws {@link BeanstalkError}
     * Throws if the response does not match the expected response.
     */
    private async handleDataResponse(expected: string): Promise<string> {
        const jobLength = await this.handleNumericResponse(expected);

        return this.connection.readBytes(jobLength);
    }

    /**
     * Handle a response from the server that contains YAML data.
     *
     * @returns Returns a promise that resolves to the decoded YAML object.
     */
    private async handleYamlMapResponse(): Promise<Yaml> {
        return this.parseYamlMap(await this.handleDataResponse('OK'));
    }

    /**
     * Handle a response from the server that contains YAML data.
     *
     * @returns Returns a promise that resolves to the decoded YAML list.
     */
    private async handleYamlListResponse(): Promise<string[]> {
        return this.parseYamlList(await this.handleDataResponse('OK'));
    }

    /**
     * Handle a response from the server that contains a reserved job.
     *
     * @returns Returns a promise that resolves to the job data, or null if reserving timed out.
     *
     * @throws {@link BeanstalkError}
     * Throws if the server returns an error.
     *
     * @throws {@link JobBuried}
     * Throws if the server runs out of memory. The job can be started with {@link kick}.
     */
    private async handleJobResponse(expected: string): Promise<Job | null> {
        const jobInfo = (await this.connection.readLine()).split(' ');

        if (jobInfo[0] === expected) {
            const id = parseInt(jobInfo[1]);
            const payload = await this.connection.readBytes(parseInt(jobInfo[2]));

            return { id, payload };
        } else if (jobInfo[0] === 'TIMED_OUT') {
            return null;
        } else if (jobInfo[0] === 'NOT_FOUND') {
            return null;
        } else if (jobInfo[0] === 'BURIED') {
            const e = new JobBuried('Server out of memory');
            e.jobId = parseInt(jobInfo[1]);
            throw e;
        } else {
            throw new BeanstalkError(jobInfo[0]);
        }
    }

    /**
     * Handle a response from the server to the 'quit' command.
     *
     * This waits for the connection to be closed by the server.
     *
     * @returns Returns a promise that resolves when the connection is closed.
     */
    private async handleCloseResponse(): Promise<void> {
        return new Promise((resolve, reject) => {
            const onClose = () => { removeListeners(); resolve(); }
            const onError = (e: Error) => { removeListeners(); reject(e); };
            const removeListeners = () => {
                this.connection.off('close', onClose);
                this.connection.off('error', onError);
            }

            this.connection.on('close', onClose);
            this.connection.on('error', onError);
        });
    }

    /**
     * Parse YAML data into a map.
     *
     * @param data - The YAML string.
     *
     * @returns Returns a map of key/value pairs.
     *
     * @throws {@link BeanstalkError}
     * Throws if the YAML is invalid.
     */
    private parseYamlMap(data: string): Yaml {
        const result = new Map<string, string | number>();

        for (const line of data.split('\n')) {
            // Start of document marker.
            if (line === '' || line === '---') {
                continue;
            }

            const colonPosition = line.indexOf(':');

            if (colonPosition === -1) {
                throw new BeanstalkError('YAML parsing failed: Expected "key: value"');
            }

            const key = line.substring(0, colonPosition);
            const value = line.substring(colonPosition + 1);
            const numericValue = Number(value);

            result.set(key, isNaN(numericValue) ? value.trim() : numericValue);
        }

        return result;
    }

    /**
     * Parse YAML data into a list.
     *
     * @param data - The YAML string.
     *
     * @returns Returns an array of strings.
     *
     * @throws {@link BeanstalkError}
     * Throws if the YAML is invalid.
     */
    private parseYamlList(data: string): string[] {
        const result: string[] = [];

        for (const line of data.split('\n')) {
            // Start of document marker.
            if (line === '' || line === '---') {
                continue;
            }

            if (line.substring(0, 2) !== '- ') {
                throw new BeanstalkError('YAML parsing failed: Expected a list marker');
            }

            result.push(line.substring(2));
        }

        return result;
    }
}
