import {writable, derived} from "svelte/store"
import {tryCatch, fetchJson, uniq, batcher, postJson, last} from "@welshman/lib"
import {collection} from "@welshman/store"
import {deriveProfile} from "./profiles.js"
import {appContext} from "./context.js"

export type Handle = {
  nip05: string
  pubkey?: string
  nip46?: string[]
  relays?: string[]
}

export const NIP05_REGEX = /^(?:([\w.+-]+)@)?([\w_-]+(\.[\w_-]+)+)$/

export async function queryProfile(nip05: string) {
  const match = nip05.match(NIP05_REGEX)

  if (!match) return undefined

  const [_, name = "_", domain] = match

  try {
    const {
      names,
      relays = {},
      nip46 = {},
    } = await fetchJson(`https://${domain}/.well-known/nostr.json?name=${name}`)

    const pubkey = names[name]

    if (!pubkey) {
      return undefined
    }

    return {
      nip05,
      pubkey,
      nip46: nip46[pubkey],
      relays: relays[pubkey],
    }
  } catch (_e) {
    return undefined
  }
}

export const handles = writable<Handle[]>([])

export const fetchHandles = async (nip05s: string[]) => {
  const base = appContext.dufflepudUrl!
  const handlesByNip05 = new Map<string, Handle>()

  // Use dufflepud if we it's set up to protect user privacy, otherwise fetch directly
  if (base) {
    const res: any = await tryCatch(
      async () => await postJson(`${base}/handle/info`, {handles: nip05s}),
    )

    for (const {handle: nip05, info} of res?.data || []) {
      if (info) {
        handlesByNip05.set(nip05, info)
      }
    }
  } else {
    const results = await Promise.all(
      nip05s.map(async nip05 => ({
        nip05,
        info: await tryCatch(async () => await queryProfile(nip05)),
      })),
    )

    for (const {nip05, info} of results) {
      if (info) {
        handlesByNip05.set(nip05, info)
      }
    }
  }

  return handlesByNip05
}

export const {
  indexStore: handlesByNip05,
  deriveItem: deriveHandle,
  loadItem: loadHandle,
  onItem: onHandle,
} = collection({
  name: "handles",
  store: handles,
  getKey: (handle: Handle) => handle.nip05,
  load: batcher(800, async (nip05s: string[]) => {
    const fresh = await fetchHandles(uniq(nip05s))
    const stale = handlesByNip05.get()

    for (const nip05 of nip05s) {
      const newHandle = fresh.get(nip05)

      if (newHandle) {
        stale.set(nip05, {...newHandle, nip05})
      }
    }

    handles.set(Array.from(stale.values()))

    return nip05s
  }),
})

export const deriveHandleForPubkey = (pubkey: string, relays: string[] = []) =>
  derived([handlesByNip05, deriveProfile(pubkey, relays)], ([$handlesByNip05, $profile]) => {
    if (!$profile?.nip05) {
      return undefined
    }

    loadHandle($profile.nip05)

    const handle = $handlesByNip05.get($profile.nip05)

    if (handle?.pubkey === pubkey) {
      return handle
    }
  })

export const displayNip05 = (nip05: string) =>
  nip05?.startsWith("_@") ? last(nip05.split("@")) : nip05

export const displayHandle = (handle: Handle) => displayNip05(handle.nip05)
