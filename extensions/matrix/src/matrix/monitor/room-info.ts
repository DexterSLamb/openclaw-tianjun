import type { MatrixClient } from "../sdk.js";

export type MatrixRoomInfo = {
  name?: string;
  canonicalAlias?: string;
  altAliases: string[];
};

export function createMatrixRoomInfoResolver(client: MatrixClient) {
  const roomInfoCache = new Map<string, MatrixRoomInfo>();

  const getRoomInfo = async (roomId: string): Promise<MatrixRoomInfo> => {
    const cached = roomInfoCache.get(roomId);
    if (cached) {
      return cached;
    }
    let name: string | undefined;
    let canonicalAlias: string | undefined;
    let altAliases: string[] = [];
    try {
      const nameState = await client.getRoomStateEvent(roomId, "m.room.name", "").catch(() => null);
      if (nameState && typeof nameState.name === "string") {
        name = nameState.name;
      }
    } catch {
      // ignore
    }
    try {
      const aliasState = await client
        .getRoomStateEvent(roomId, "m.room.canonical_alias", "")
        .catch(() => null);
      if (aliasState && typeof aliasState.alias === "string") {
        canonicalAlias = aliasState.alias;
      }
      const rawAliases = aliasState?.alt_aliases;
      if (Array.isArray(rawAliases)) {
        altAliases = rawAliases.filter((entry): entry is string => typeof entry === "string");
      }
    } catch {
      // ignore
    }
    const info = { name, canonicalAlias, altAliases };
    roomInfoCache.set(roomId, info);
    return info;
  };

  const getMemberDisplayName = async (roomId: string, userId: string): Promise<string> => {
    try {
      const memberState = await client
        .getRoomStateEvent(roomId, "m.room.member", userId)
        .catch(() => null);
      if (memberState && typeof memberState.displayname === "string") {
        return memberState.displayname;
      }
      return userId;
    } catch {
      return userId;
    }
  };

  return {
    getRoomInfo,
    getMemberDisplayName,
  };
}
