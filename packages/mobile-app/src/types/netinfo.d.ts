/**
 * Minimal type declarations for @react-native-community/netinfo.
 * The full package will be installed as a native dependency.
 */
declare module '@react-native-community/netinfo' {
  interface NetInfoState {
    isConnected: boolean | null;
    isInternetReachable: boolean | null;
    type: string;
  }

  interface NetInfo {
    fetch(): Promise<NetInfoState>;
    addEventListener(
      listener: (state: NetInfoState) => void,
    ): () => void;
  }

  const netInfo: NetInfo;
  export default netInfo;
  export type { NetInfoState };
}
