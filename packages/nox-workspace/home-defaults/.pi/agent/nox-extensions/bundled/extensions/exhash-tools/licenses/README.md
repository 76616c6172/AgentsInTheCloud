# Bundled runtime notices

- `../THIRD-PARTY-NOTICES.txt` is generated from the locked Cargo dependency sources, including upstream exhash (Apache-2.0). No upstream source file is modified by this extension.
- `RUST-COPYRIGHT.html` is copied from the selected Rust toolchain's standard-library copyright report by the build script.
- `wasi-libc-*` notices are from the wasi-libc revision used by wasi-sdk 34.0: `2e6fb9d8ee0cdf9e431fbcabe8af3115de000a13`.

Sources:

- https://github.com/AnswerDotAI/exhash/tree/47dd5b49ad6ce77279062229e4138b2b905f906c
- https://github.com/rust-lang/rust/tree/1.99.0
- https://github.com/WebAssembly/wasi-sdk/tree/wasi-sdk-34
- https://github.com/WebAssembly/wasi-libc/tree/2e6fb9d8ee0cdf9e431fbcabe8af3115de000a13

Retain these notices when copying/distributing the WebAssembly bundle. Review runtime notices again when updating toolchains.
