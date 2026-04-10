import { describe, it, expect } from 'vitest'
import { RingBuffer } from '../ring-buffer.js'

describe('RingBuffer', () => {
  it('starts empty with correct capacity', () => {
    const buf = new RingBuffer<number>(42)
    expect(buf.size).toBe(0)
    expect(buf.capacity).toBe(42)
    expect(buf.toArray()).toEqual([])
  })

  it('push, eviction, and ordering lifecycle', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(1); buf.push(2); buf.push(3)
    expect(buf.toArray()).toEqual([1, 2, 3])
    buf.push(4)
    expect(buf.toArray()).toEqual([2, 3, 4])
    for (let i = 5; i <= 100; i++) buf.push(i)
    expect(buf.toArray()).toEqual([98, 99, 100])
  })

  it('filters items', () => {
    const buf = new RingBuffer<number>(5)
    for (let i = 1; i <= 5; i++) buf.push(i)
    expect(buf.filter((n) => n > 3)).toEqual([4, 5])
  })

  it('clears and works after refill', () => {
    const buf = new RingBuffer<number>(3)
    buf.push(1); buf.push(2)
    buf.clear()
    expect(buf.size).toBe(0)
    buf.push(10); buf.push(20)
    expect(buf.toArray()).toEqual([10, 20])
  })

  it('handles single capacity', () => {
    const buf = new RingBuffer<string>(1)
    buf.push('a')
    expect(buf.toArray()).toEqual(['a'])
    buf.push('b')
    expect(buf.toArray()).toEqual(['b'])
  })
})
