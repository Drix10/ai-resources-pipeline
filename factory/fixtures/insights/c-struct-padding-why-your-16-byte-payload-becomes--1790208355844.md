# C Struct Padding: Why Your 16-Byte Payload Becomes 32 Bytes


![C Struct Padding: Why Your 16-Byte Payload Becomes 32 Bytes](/slides/c-struct-padding-why-your-16-byte-payload-becomes--1790208355844.png)

LeetCode graph tricks are useless if you don't understand raw memory in C. I learned this the hard way in my Grind repo.

I ran into a performance bottleneck where a seemingly small 16-byte data structure was causing double the expected L1 cache misses. The culprit was careless struct member ordering, silently doubling its memory footprint to 32 bytes.

In C, compilers align struct members to optimize memory access, often to the size of the largest member or the CPU's word size. This introduces 'padding' bytes to ensure subsequent members start at an address that's a multiple of their size.

Consider `struct { char a; int b; char c; }`. Logically, this is 1 + 4 + 1 = 6 bytes. However, `int b` needs 4-byte alignment. If `char a` is at address 0, `int b` cannot start at address 1; it will start at address 4, leaving 3 padding bytes. `char c` then follows `int b`. The entire struct will often be padded to a multiple of 4, making its size 12 bytes.

This principle scales up. A logical 16-byte payload, due to similar padding, can occupy 32 bytes in memory.

Drishtant Ghosh
Follow for daily systems engineering & code teardowns.

---
### 🔗 Reference & Source Breakdown
- **Source Material**: [Tech Infrastructure: 🚀 AI Engineering - Serverless Inference](https://github.com/Drix10/ai-resources/blob/main/Tech%20Infrastructure/resources-254.md)
- **Recommended Visual Asset**: Real-world visual artifact: Clean dark-mode terminal screenshot of code from Drix10/Grind running or compiling.
- **First Comment**: Check out the code & architecture on GitHub → https://github.com/Drix10/Grind
Personal blog & deep-dives: https://blogs.drix10.com
- **Syndicated Channel**: LinkedIn & Personal Blog Hub
