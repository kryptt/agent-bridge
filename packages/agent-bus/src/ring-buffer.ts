export class RingBuffer<T> {
  private buffer: (T | undefined)[]
  private head: number
  private count: number
  readonly capacity: number

  constructor (capacity: number) {
    this.capacity = capacity
    this.buffer = new Array(capacity)
    this.head = 0
    this.count = 0
  }

  push (item: T): void {
    this.buffer[this.head] = item
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  /** Returns items oldest-first */
  toArray (): T[] {
    if (this.count === 0) return []
    const result: T[] = []
    const start = this.count < this.capacity
      ? 0
      : this.head
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity
      result.push(this.buffer[idx] as T)
    }
    return result
  }

  /** Returns items matching predicate, oldest-first */
  filter (predicate: (item: T) => boolean): T[] {
    return this.toArray().filter(predicate)
  }

  clear (): void {
    this.buffer = new Array(this.capacity)
    this.head = 0
    this.count = 0
  }

  get size (): number {
    return this.count
  }
}
