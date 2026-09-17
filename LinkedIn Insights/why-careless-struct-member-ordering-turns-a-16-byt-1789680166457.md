# Why careless struct member ordering turns a 16-byte payload into 32 bytes due to word alignment, doubling L1 cache line misses


![Why careless struct member ordering turns a 16-byte payload into 32 bytes due to word alignment, doubling L1 cache line misses](/slides/why-careless-struct-member-ordering-turns-a-16-byt-1789680166457.png)

In my codebase, I noticed that struct padding was causing a 16-byte payload to expand to 32 bytes, leading to L1 cache line misses and performance degradation.

This issue arises from the way C/C++ compilers align data to word boundaries, which can lead to padding bytes being inserted between struct members. To mitigate this, I used a combination of struct packing and bit-field manipulation to minimize padding and optimize memory usage.

For example, consider the following struct:

The compiler will align the `int` member `b` to a 4-byte boundary, resulting in 4 bytes of padding between `a` and `b`. This will cause the struct to occupy 12 bytes instead of 6.

To fix this, I used the `__attribute__((packed))` compiler directive to pack the struct tightly:

This will eliminate the padding and reduce the struct size to 6 bytes.

Another approach is to use bit-field manipulation to reduce the size of the `int` member:

By packing the `int` member, we can reduce its size to 2 bytes, resulting in a total struct size of 6 bytes.

By understanding the intricacies of struct alignment and padding, developers can write more efficient and effective C/C++ code.

Drishtant Ghosh
Follow for daily systems engineering & code teardowns.

---
### 🔗 Reference & Source Breakdown
- **Source Material**: [Tech Infrastructure: 🤖 AI Infrastructure - Cloud Cost Reality Check](https://github.com/Drix10/ai-resources/blob/main/Tech%20Infrastructure/resources-244.md)
- **Recommended Visual Asset**: Real-world visual artifact: Clean dark-mode terminal screenshot of code from Drix10/Grind running or compiling.
- **First Comment**: Check out the code & architecture on GitHub → https://github.com/Drix10/Grind
Personal blog & deep-dives: https://blogs.drix10.com
- **Syndicated Channel**: LinkedIn & Personal Blog Hub
