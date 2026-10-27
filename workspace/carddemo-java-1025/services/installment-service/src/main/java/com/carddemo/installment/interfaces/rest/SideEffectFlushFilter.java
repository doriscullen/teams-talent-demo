package com.carddemo.installment.interfaces.rest;

import com.carddemo.installment.infrastructure.support.SideEffectTransactions;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

/**
 * 请求边界副作用落库（A-PERF-001）。
 *
 * <p>业务事务在本过滤器下游完成并已归还连接，因此这里执行审计/通知的独立事务时每次只借一条连接，
 * 不会出现在提交回调里借连接导致的连接池饥饿。业务事务回滚时登记的副作用已在
 * {@link SideEffectTransactions#submit} 的回滚钩子中丢弃。</p>
 */
@Component
public class SideEffectFlushFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(SideEffectFlushFilter.class);

    private final SideEffectTransactions sideEffects;

    public SideEffectFlushFilter(SideEffectTransactions sideEffects) {
        this.sideEffects = sideEffects;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        try {
            chain.doFilter(request, response);
        } finally {
            try {
                sideEffects.flush();
            } catch (RuntimeException ex) {
                // 响应已产生；副作用失败已由填写方写入补偿队列/记录日志，不改变业务结果
                log.warn("side effect flush failed after request: path={} error={}",
                        request.getRequestURI(), ex.getMessage());
            }
        }
    }
}
