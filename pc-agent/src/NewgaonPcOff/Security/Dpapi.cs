using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace NewgaonPcOff.Security;

/// <summary>
/// 윈도우가 제공하는 데이터 보호(DPAPI)를 직접 부른다.
///  · 쉬운 설명: <b>지금 로그인한 사용자만</b> 풀 수 있는 자물쇠로 데이터를 잠근다.
///    파일을 USB로 복사해 다른 PC·다른 계정으로 가져가도 열리지 않는다.
///  · 왜 외부 라이브러리를 안 쓰나: NuGet 패키지 없이 윈도우 기본 기능(crypt32.dll)만 쓰면
///    설치본이 가벼워지고 백신 오탐·라이선스 문제가 생기지 않는다.
/// </summary>
internal static class Dpapi
{
    [StructLayout(LayoutKind.Sequential)]
    private struct DataBlob
    {
        public int cbData;
        public IntPtr pbData;
    }

    private const int CryptprotectUiForbidden = 0x1; // 화면에 창을 띄우지 않는다(백그라운드 앱이므로 필수)

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptProtectData(
        ref DataBlob pDataIn, string? szDataDescr, IntPtr pOptionalEntropy,
        IntPtr pvReserved, IntPtr pPromptStruct, int dwFlags, out DataBlob pDataOut);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CryptUnprotectData(
        ref DataBlob pDataIn, IntPtr ppszDataDescr, IntPtr pOptionalEntropy,
        IntPtr pvReserved, IntPtr pPromptStruct, int dwFlags, out DataBlob pDataOut);

    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr hMem);

    /// <summary>
    /// 잠근다.
    /// </summary>
    /// <param name="entropy">
    /// 추가 자물쇠. 이 값을 모르면 DPAPI 한 줄로는 풀 수 없다.
    ///  · ⚠️ <b>용도마다 다른 값을 쓰고, 한 번 정한 값은 절대 바꾸지 않는다.</b>
    ///    바꾸면 이미 저장된 파일이 열리지 않는다 — 그러면 "연결됨으로 보이는데 실제로는 미연결"인
    ///    상태가 되어 PC가 조용히 잠기지 않는다(2-A 검수에서 실제로 잡힌 치명 사고).
    ///  · 솔직한 한계: 프로그램 안에 들어 있으므로 마음먹고 파보면 알아낼 수 있다(난독화 수준).
    ///    그래도 "같은 계정에서 도는 아무 프로그램이 한 줄로 꺼내는" 가장 쉬운 길은 막힌다.
    /// </param>
    public static byte[] Protect(byte[] plain, byte[] entropy)
    {
        ArgumentNullException.ThrowIfNull(plain);
        ArgumentNullException.ThrowIfNull(entropy);
        return Run(plain, entropy, encrypt: true);
    }

    /// <summary>푼다. <paramref name="entropy"/>는 잠글 때 쓴 값과 <b>정확히 같아야</b> 한다.</summary>
    public static byte[] Unprotect(byte[] encrypted, byte[] entropy)
    {
        ArgumentNullException.ThrowIfNull(encrypted);
        ArgumentNullException.ThrowIfNull(entropy);
        return Run(encrypted, entropy, encrypt: false);
    }

    private static byte[] Run(byte[] input, byte[] entropy, bool encrypt)
    {
        var inPtr = Marshal.AllocHGlobal(input.Length == 0 ? 1 : input.Length);
        var entPtr = Marshal.AllocHGlobal(entropy.Length == 0 ? 1 : entropy.Length);
        // 추가 자물쇠는 구조체(DATA_BLOB)를 가리키는 포인터로 넘겨야 한다 — 관리 메모리를 고정하는 대신
        // 비관리 메모리에 구조체를 그대로 써서 넘긴다(가장 오해가 적은 방식).
        var entBlobPtr = Marshal.AllocHGlobal(Marshal.SizeOf<DataBlob>());
        var outBlob = default(DataBlob);
        var outSize = 0;
        try
        {
            Marshal.Copy(input, 0, inPtr, input.Length);
            Marshal.Copy(entropy, 0, entPtr, entropy.Length);
            Marshal.StructureToPtr(new DataBlob { cbData = entropy.Length, pbData = entPtr }, entBlobPtr, false);

            var inBlob = new DataBlob { cbData = input.Length, pbData = inPtr };
            var ok = encrypt
                ? CryptProtectData(ref inBlob, null, entBlobPtr, IntPtr.Zero, IntPtr.Zero, CryptprotectUiForbidden, out outBlob)
                : CryptUnprotectData(ref inBlob, IntPtr.Zero, entBlobPtr, IntPtr.Zero, IntPtr.Zero, CryptprotectUiForbidden, out outBlob);

            if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error());

            outSize = outBlob.cbData;
            var result = new byte[outSize];
            Marshal.Copy(outBlob.pbData, result, 0, outSize);
            return result;
        }
        finally
        {
            // 평문이 메모리에 남지 않도록 쓰고 나서 지운다(입력·출력 **양쪽 다**).
            if (inPtr != IntPtr.Zero)
            {
                for (var i = 0; i < input.Length; i++) Marshal.WriteByte(inPtr, i, 0);
                Marshal.FreeHGlobal(inPtr);
            }
            if (entPtr != IntPtr.Zero) Marshal.FreeHGlobal(entPtr);
            if (entBlobPtr != IntPtr.Zero) Marshal.FreeHGlobal(entBlobPtr);
            if (outBlob.pbData != IntPtr.Zero)
            {
                // ⚠️ 복호화 결과에는 토큰 평문이 담겨 있다. 해제 전에 0으로 덮는다.
                for (var i = 0; i < outSize; i++) Marshal.WriteByte(outBlob.pbData, i, 0);
                LocalFree(outBlob.pbData);
            }
        }
    }
}
