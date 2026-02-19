package com.example.finsentinel.service.news;

import com.example.finsentinel.model.NewsItem;
import lombok.Getter;
import org.springframework.context.ApplicationEvent;

@Getter
public class NewsItemCreatedEvent extends ApplicationEvent {

    private final NewsItem newsItem;

    public NewsItemCreatedEvent(Object source, NewsItem newsItem) {
        super(source);
        this.newsItem = newsItem;
    }
}
