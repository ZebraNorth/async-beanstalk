# Async Beanstalk

[Zebra North](https://zebra-north.com)

---

## About

Async-Beanstalk is a fast, lightweight client for Beanstalk servers.

- Easy to use
- Async/await, promise based interface
- No dependencies
- Fully asynchronous
- 10x faster than node-beanstalk
- Implements the full Beanstalk 1.13 [protocol](https://github.com/beanstalkd/beanstalkd/blob/master/doc/protocol.txt)
- Fully TypeScript safe

## Installation with NPM / Yarn

```sh
# NPM
npm install @zebranorth/async-beanstalk

# Yarn
yarn add @zebranorth/async-beanstalk
```

## API Documentation

Read the [API Documentation here](https://zebranorth.github.io/async-beanstalk/classes/Client.html).

## Simple Usage

This shows the simplest way to use the client, running each command synchronously.

```ts
import { Client } from '@zebranorth/async-beanstalk';

/**
 * A "producer" places jobs into a queue.
 */
async function producer() {
    // Create the client.
    const client = new Client();

    // Connect to the Beanstalk server.
    await client.connect('beanstalk');

    // Set the tube (named queue) into which jobs will be placed.
    await client.use('example-queue');

    // Create an example job.
    const exampleJob = {
        myData: 'This object will be placed into the queue.'
    };

    // Serialize the job into a string and put it into the "example-queue" tube.
    // You can use any serialization. JSON.stringify is convenient.
    await client.put(JSON.stringify(exampleJob));

    // Disconnect from the server.
    await client.close();
}

/**
 * A "consumer" waits for a job to be placed into the queue,
 * then takes it and processes it.
 */
async function consumer() {
    // Create the client.
    const client = new Client();

    // Connect to the Beanstalk server.
    await client.connect('beanstalk');

    // Set the tube from which jobs will be retrieved.
    await client.watch('example-queue');

    // Read the job from the "example" tube.
    const job = await client.reserve();

    console.log('Reserved job ID: ', job.id);
    console.log('Reserved job data: ', JSON.parse(job.payload));

    // Delete the job once it has been successfully processed.
    await client.delete(job.id);

    // Disconnect from the server.
    await client.close();
}

producer();
consumer();
```

## Efficient Bulk Commands

The client contains an internal queue of commands, meaning that you do not have to wait for one
command to finish before issuing the next command. Commands are guaranteed to be excuted in the
order in which they are issued.

We can take advantage of this by issuing many commands at once, and only waiting for them to complete
once we need to close the connection.

```ts
import { Client } from '@zebranorth/async-beanstalk';

/**
 * A "producer" places jobs into a queue.
 */
async function producer() {
    // Create the client.
    const client = new Client();

    // Connect to the Beanstalk server.
    await client.connect('beanstalk');

    // Set the tube (named queue) into which jobs will be placed.
    client.use('example-queue');

    // Store promises for commands that have been sent to the server.
    const putCommands: Promise<number>[] = [];

    // Put 100 jobs into the queue.
    for (let i = 0; i < 100; ++i) {
        putCommands.push(client.put('Job ' + i.toString()));
    }

    // Wait for all the jobs to be put into the queue.
    await Promise.all(putCommands);

    // Disconnect from the server.
    await client.close();
}

/**
 * A "consumer" waits for a job to be placed into the queue,
 * then takes it and processes it.
 */
async function consumer() {
    // Create the client.
    const client = new Client();

    // Connect to the Beanstalk server.
    await client.connect('beanstalk');

    // Set the tube from which jobs will be retrieved.
    await client.watch('example-queue');

    // Store promises for commands that have been sent to the server.
    const reserveCommands: Promise<void>[] = []
    const deleteCommands: Promise<void>[] = [];

    // Take 100 jobs from the queue, then delete them.
    for (let i = 0; i < 100; ++i) {
        const reserveJob = client.reserve().then((job) => {
            console.log('Reserved: ' + job.payload);
            deleteCommands.push(client.delete(job.id));
        });

        reserveCommands.push(reserveJob);
    }

    // Wait for all the "reserve" commands to complete.
    await Promise.all(reserveCommands);

    // Wait for all the "delete" commands to complete.
    await Promise.all(deleteCommands);

    // Disconnect from the server.
    await client.close();
}

producer();
consumer();
```

## TypeScript Types

There are some helper types exported.

```ts
import { Client, type Job, type Yaml } from '@zebranorth/async-beanstalk';
```

### `Job`

A `Job` is returned by `reserve()` or `reserveWithTimeout()` and contains two properties:
The job ID and the payload as a string.

```ts
type Job = {
    /**
     * The Beanstalk server's ID for the job.
     */
    id: number,

    /**
     * The raw job data.
     */
    payload: string
};
```

### `Yaml`

The `Yaml` type is an alias for a `Map` containing numbers or strings, and is used to return server statistics.

```ts
type Yaml = Map<string, string | number>;
```
