// @flow
import { throttle } from 'lodash'
import { KEY_PREFIX } from './constants'

import type { Persistoid, PersistConfig, Transform } from './types'

type IntervalID = any // @TODO remove once flow < 0.63 support is no longer required.

export default function createPersistoid(config: PersistConfig): Persistoid {
  // defaults
  const blacklist: ?Array<string> = config.blacklist || null
  const whitelist: ?Array<string> = config.whitelist || null
  const transforms = config.transforms || []
  const throttleTime = config.throttle || 0
  const storageKey = `${
    config.keyPrefix !== undefined ? config.keyPrefix : KEY_PREFIX
  }${config.key}`
  const storage = config.storage
  const serialize = config.serialize === false ? x => x : defaultSerialize

  // initialize stateful values
  let lastState = {}
  let stagedState = {}
  let keysToProcess = []
  let writePromise = null

  const throttledProcess = throttle(processKeys, throttleTime)

  const update = (state: Object) => {
    // add any changed keys to the queue
    Object.keys(state).forEach(key => {
      let subState = state[key]
      if (!passWhitelistBlacklist(key)) return // is keyspace ignored? noop
      if (lastState[key] === state[key]) return // value unchanged? noop
      if (keysToProcess.indexOf(key) !== -1) return // is key already queued? noop
      keysToProcess.push(key) // add key to queue
    })
    lastState = state
    throttledProcess()
  }

  function processKeys() {
    while (keysToProcess.length > 0) {
      let key = keysToProcess.shift()
      let endState = transforms.reduce((subState, transformer) => {
        return transformer.in(subState, key, lastState)
      }, lastState[key])
      if (typeof endState !== 'undefined') {
        try {
          stagedState[key] = serialize(endState)
        } catch (err) {
          console.error(
            'redux-persist/createPersistoid: error serializing state',
            err
          )
        }
      } else {
        //if the end state is undefined, we should delete the old value
        delete stagedState[key]
      }
    }

    // cleanup any removed keys just before write.
    Object.keys(stagedState).forEach(key => {
      if (lastState[key] === undefined) {
        delete stagedState[key]
      }
    })

    writePromise = storage
      .setItem(storageKey, serialize(stagedState))
      .catch(onWriteFail)
  }

  function passWhitelistBlacklist(key) {
    if (whitelist && whitelist.indexOf(key) === -1 && key !== '_persist')
      return false
    if (blacklist && blacklist.indexOf(key) !== -1) return false
    return true
  }

  function onWriteFail(err) {
    // @TODO add fail handlers (typically storage full)
    if (err && throttledProcess.env.NODE_ENV !== 'production') {
      console.error('Error storing data', err)
    }
  }

  const flush = () => {
    processKeys()
    return writePromise || Promise.resolve()
  }

  // return `persistoid`
  return {
    update,
    flush,
  }
}

// @NOTE in the future this may be exposed via config
function defaultSerialize(data) {
  return JSON.stringify(data)
}
