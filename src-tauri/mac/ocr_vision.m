// macOS 零二进制 OCR — Apple Vision（VNRecognizeTextRequest），in-process，链接系统框架。
//
// 逻辑改编自姊妹项目 AgileShot 的 localocrengine_mac.mm（同作者，已在生产验证）：
//   - 去掉 Qt/QPixmap，改从文件路径加载图（ImageIO CGImageSource），与本项目 OCR 统一“喂路径”。
//   - 暴露纯 C ABI 供 Rust FFI 调用（services/mac_ocr.rs）。
//   - Accurate 级别 + 语言纠正 + 指定中英语言；指定语言失败退默认语言重试一次，尽量不空手而归。
//
// 编译：build.rs 用 cc `-fobjc-arc` 编译，链接 Vision/Foundation/CoreGraphics/ImageIO。
// 内存：ARC 管理 NS* 对象；CF/CG 句柄（CGImageSource/CGImage）非 ARC，手动 CFRelease/CGImageRelease。
//       返回值用 strdup(malloc)，由 Rust 侧 kb_mac_vision_free(free) 释放。

// ⚠️ 与 AgileShot 相同的坑：某些编译定义（如 tiny-AES 的 -DCTR=1）会污染 Carbon 头里的
//    `UnsignedWide CTR;` 成员。本项目当前无此宏，但保留防御式 #undef，必须在任何系统头之前。
#ifdef CTR
#  undef CTR
#endif

#import <Vision/Vision.h>
#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>

#include <stdlib.h>
#include <string.h>

/// macOS 10.15+ 才有 VNRecognizeTextRequest。返回 1 可用 / 0 不可用。
int kb_mac_vision_available(void) {
    if (@available(macOS 10.15, *)) {
        return 1;
    }
    return 0;
}

/// 识别 image_path 指向的图片，返回按行拼接的全文（malloc 的 UTF-8 C 串，调用方 free）。
/// 返回 NULL = 识别失败；返回 "" = 成功但无文字。
char* kb_mac_vision_recognize(const char* image_path) {
    if (@available(macOS 10.15, *)) {
        @autoreleasepool {
            if (image_path == NULL) {
                return NULL;
            }
            NSString* path = [NSString stringWithUTF8String:image_path];
            if (path == nil) {
                return NULL;
            }
            NSURL* url = [NSURL fileURLWithPath:path];

            // ImageIO 从文件读出 CGImage（非 ARC，手动释放）
            CGImageSourceRef src = CGImageSourceCreateWithURL((__bridge CFURLRef)url, NULL);
            if (src == NULL) {
                return NULL;
            }
            CGImageRef cg = CGImageSourceCreateImageAtIndex(src, 0, NULL);
            CFRelease(src);
            if (cg == NULL) {
                return NULL;
            }

            // 第一次：指定中英语言
            NSError* err = nil;
            VNRecognizeTextRequest* req = [[VNRecognizeTextRequest alloc] init];
            req.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
            req.usesLanguageCorrection = YES;
            req.recognitionLanguages = @[ @"zh-Hans", @"zh-Hant", @"en-US" ];
            VNImageRequestHandler* handler =
                [[VNImageRequestHandler alloc] initWithCGImage:cg options:@{}];
            BOOL ok = [handler performRequests:@[ req ] error:&err];

            // 指定语言在某些系统/硬件不支持 → 退默认语言重试一次
            if (!ok || err != nil) {
                err = nil;
                req = [[VNRecognizeTextRequest alloc] init];
                req.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
                req.usesLanguageCorrection = YES;
                VNImageRequestHandler* h2 =
                    [[VNImageRequestHandler alloc] initWithCGImage:cg options:@{}];
                ok = [h2 performRequests:@[ req ] error:&err];
            }

            NSMutableArray<NSString*>* lines = [NSMutableArray array];
            if (ok && err == nil) {
                for (VNRecognizedTextObservation* obs in req.results) {
                    VNRecognizedText* top = [[obs topCandidates:1] firstObject];
                    if (top != nil && top.string.length > 0) {
                        [lines addObject:top.string];
                    }
                }
            }
            CGImageRelease(cg);

            if (!ok || err != nil) {
                return NULL; // 真正的失败
            }

            NSString* full = [lines componentsJoinedByString:@"\n"];
            const char* utf8 = [full UTF8String];
            if (utf8 == NULL) {
                return NULL;
            }
            return strdup(utf8); // malloc 拷贝，Rust 侧 free
        }
    }
    return NULL;
}

/// 释放 kb_mac_vision_recognize 返回的字符串。
void kb_mac_vision_free(char* p) {
    if (p != NULL) {
        free(p);
    }
}
