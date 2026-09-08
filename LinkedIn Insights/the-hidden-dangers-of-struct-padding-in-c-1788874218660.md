# The Hidden Dangers of Struct Padding in C


![The Hidden Dangers of Struct Padding in C](/slides/the-hidden-dangers-of-struct-padding-in-c-1788874218660.png)

In C, struct padding can silently double your memory usage, leading to performance bottlenecks and cache thrashing.

This is not just a theoretical concern, but a real-world problem that can be observed in the codebases of many systems programmers.

When I built a high-performance network stack using C, I ran into a weird bug where a seemingly innocuous struct was consuming twice the expected memory.

After hours of debugging, I discovered the culprit: careless struct member ordering.

The issue arises from the way C handles struct member alignment.

When a struct is declared, the compiler will automatically add padding bytes to ensure that each member is aligned to a word boundary.

This can lead to a notable increase in memory usage, especially when dealing with small structs.

For example, consider the following struct: `struct foo { int a; char b; };`.

The compiler will add padding bytes to ensure that `a` is aligned to a 4-byte boundary, resulting in a total size of 8 bytes.

However, if we add another member to the struct, `struct foo { int a; char b; char c; };`, the compiler will add even more padding bytes to ensure that `a` is aligned to a 4-byte boundary, resulting in a total size of 12 bytes.

To avoid this issue, developers can use techniques such as packing structs or using custom alignment attributes.

In my codebase, I used the `attribute((packed))` compiler directive to ensure that the struct was packed tightly without any padding.

finally, struct padding is a real-world problem that can have notable performance implications.

By understanding the underlying mechanics of struct alignment and using techniques to mitigate its effects, developers can write more efficient and effective C code.

Drishtant Ghosh
Follow for daily systems engineering & code teardowns.

---
### 🔗 Reference & Source Breakdown
- **Source Material**: [Drix10/Grind: 100 Foundational C Programs & Low-Level Memory Fundamentals](https://github.com/Drix10/Grind)
- **Recommended Visual Asset**: Real-world visual artifact: Clean dark-mode terminal screenshot of code from Drix10/Grind running or compiling.
- **Syndicated Channel**: LinkedIn & Personal Blog Hub
