import net from "node:net";

export type PortProbe = (port: number) => Promise<boolean>;

async function defaultPortProbe(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ port, host: "127.0.0.1" }, () => {
      server.close(() => resolve(true));
    });
  });
}

export class PortAllocator {
  constructor(
    private readonly rangeStart: number,
    private readonly rangeEnd: number,
    private readonly probe: PortProbe = defaultPortProbe
  ) {
    if (rangeStart >= rangeEnd) {
      throw new Error("Invalid port range");
    }
  }

  async allocateMany(count: number, existingPorts: Set<number>): Promise<number[]> {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("count must be a positive integer");
    }

    const reserved = new Set(existingPorts);
    const ports: number[] = [];

    for (let port = this.rangeStart; port <= this.rangeEnd; port++) {
      if (reserved.has(port)) {
        continue;
      }

      const available = await this.probe(port);
      if (!available) {
        continue;
      }

      reserved.add(port);
      ports.push(port);

      if (ports.length === count) {
        return ports;
      }
    }

    throw new Error(`Unable to allocate ${count} free ports in configured range`);
  }
}
