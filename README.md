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

## Installation

Add the package using:

**NPM**
```sh
npm install @zebranorth/async-beanstalk
```

**Yarn**
```sh
yarn add @zebranorth/async-beanstalk
```

## Simple Usage

This shows the simplest way to use the client, running each command synchronously.

```ts
import { Client } from 'async-beanstalk';

async function example() {
    // Create the client.
    const client = new Client();

    // Connect to the Beanstalk server.
    await client.connect('beanstalk');

    // Set the tube (named queue) into which jobs will be placed.
    await client.use('example');

    // Set the tube from which jobs will be retrieved.
    await client.watch('example');

    // Create an example job.
    const exampleJob = {
        myData: 'anything'
    };

    // Put the job into the "example" tube.
    await client.put(JSON.stringify(exampleJob));

    // Read the job from the "example" tube.
    const job = await client.reserve();

    console.log('Reserved job ID: ', job.id);
    console.log('Reserved job data: ', JSON.parse(job.payload));
}

example();
```

## Efficient Usage

The client contains an internal queue of commands, meaning that you do not have to wait for one
command to finish before issuing the next command. Commands are guaranteed to be excuted in the
order in which they are issued.

## TypeScript Types

There are some helper types exported.

```ts
import { Client, type Job, type Yaml } from 'async-beanstalk';
```

### `Job`

A `Job` is returned by `reserve()` or `reserveWithTimeout()` and contains two properties: The job ID and the payload as a string.

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
