// A minimal event emitter with no dependencies, used for sockets and problems.

export function createEmitter() {
  const map = new Map()
  return {
    on(type, fn) {
      let set = map.get(type)
      if (!set) map.set(type, (set = new Set()))
      set.add(fn)
      return () => set.delete(fn)
    },
    off(type, fn) {
      map.get(type)?.delete(fn)
    },
    emit(type, ...args) {
      const set = map.get(type)
      if (!set) return
      for (const fn of [...set]) fn(...args)
    },
  }
}
